import { Request, Response, NextFunction } from 'express'
import jwt from 'jsonwebtoken'
import bcrypt from 'bcryptjs'
import { v4 as uuidv4 } from 'uuid'
import prisma from '../lib/prisma'
import { AppError } from '../middleware/errorHandler'
import { emailService } from '../services/email.service'
import { s3Service } from '../services/s3.service'
import { env } from '../config/env'
import { auditLogService } from '../services/auditLog.service'
import { AdminRequest } from '../middleware/adminAuth'

const MAX_LOGIN_ATTEMPTS = 5
const LOCKOUT_MINUTES    = 15

export async function portalLogin(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { email, password } = req.body
    const normalizedEmail = String(email || '').trim().toLowerCase()

    // 1. Try Admin table (includes Celebrities)
    const admin = await prisma.admin.findUnique({
      where: { email: normalizedEmail },
      include: { celebrity: { select: { onboarding_status: true, name: true } } },
    })

    if (admin) {
      if (admin.locked_until && admin.locked_until > new Date()) {
        const minutesLeft = Math.ceil((admin.locked_until.getTime() - Date.now()) / 60000)
        throw new AppError(`Account locked due to too many failed attempts. Try again in ${minutesLeft} minute(s).`, 429)
      }

      if (await bcrypt.compare(password, admin.password)) {
        if (!admin.is_active) throw new AppError('Account is not active', 403)
        if (admin.celebrity_id && admin.celebrity?.onboarding_status !== 'approved') {
          throw new AppError('Celebrity portal access is not approved yet', 403)
        }

        await prisma.admin.update({ where: { id: admin.id }, data: { last_login_at: new Date(), login_attempts: 0, locked_until: null } })

        const token = jwt.sign(
          { adminId: admin.id, role: admin.role },
          env.adminJwtSecret,
          { expiresIn: '12h' }
        )

        res.json({
          success: true,
          token,
          role: admin.celebrity_id ? 'celebrity' : 'admin',
          user: {
            id: admin.id,
            name: admin.name,
            email: admin.email,
            celebrity_id: admin.celebrity_id,
          },
          redirect: admin.celebrity_id ? '/celebrity/profile' : '/',
        })
        return
      } else {
        // Record failed attempt
        const lockoutExpired = admin.locked_until !== null && admin.locked_until <= new Date()
        const baseAttempts   = lockoutExpired ? 0 : admin.login_attempts
        const attempts       = baseAttempts + 1
        const lockedUntil    = attempts >= MAX_LOGIN_ATTEMPTS
          ? new Date(Date.now() + LOCKOUT_MINUTES * 60 * 1000)
          : null
        await prisma.admin.update({
          where: { id: admin.id },
          data:  { login_attempts: attempts, locked_until: lockedUntil },
        })
        throw new AppError('Invalid credentials', 401)
      }
    }

    // 2. Try Manager table
    const manager = await prisma.manager.findUnique({
      where: { email: normalizedEmail },
    })

    if (manager) {
      if (await bcrypt.compare(password, manager.password)) {
        if (!manager.is_active) throw new AppError('Account is not active', 403)

        await prisma.manager.update({
          where: { id: manager.id },
          data: { last_login_at: new Date() },
        })

        const token = jwt.sign(
          { managerId: manager.id, portal: 'manager' },
          env.adminJwtSecret,
          { expiresIn: '12h' },
        )

        res.json({
          success: true,
          token,
          role: 'manager',
          user: {
            id: manager.id,
            name: manager.name,
            email: manager.email,
          },
          redirect: '/manager/dashboard',
        })
        return
      }
    }

    throw new AppError('Invalid credentials', 401)
  } catch (err) {
    next(err)
  }
}

export async function getDashboardStats(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const [totalUsers, totalVideos, totalLeads, totalCelebrities,
      pendingJobs, activeLeads, recentJobs, recentLeads] = await Promise.all([
      prisma.user.count(),
      prisma.videoJob.count(),
      prisma.lead.count(),
      prisma.celebrity.count({ where: { is_active: true } }),
      prisma.videoJob.count({ where: { status: 'pending' } }),
      prisma.lead.count({ where: { status: { in: ['new', 'contacted', 'negotiating'] } } }),
      prisma.videoJob.findMany({
        orderBy: { created_at: 'desc' },
        take: 5,
        include: {
          user:      { select: { name: true, email: true } },
          celebrity: { select: { name: true, initials: true } },
        },
      }),
      prisma.lead.findMany({
        orderBy: { created_at: 'desc' },
        take: 5,
      }),
    ])

    const revenueAgg = await prisma.lead.aggregate({
      where: { status: 'paid' },
      _sum: { estimated_value: true },
    })
    const totalRevenue = revenueAgg._sum.estimated_value ?? 0

    res.json({
      success: true,
      data: {
        stats: { totalUsers, totalVideos, totalLeads, totalCelebrities, pendingJobs, activeLeads, totalRevenue },
        recentJobs,
        recentLeads,
      },
    })
  } catch (err) {
    next(err)
  }
}

export async function listUsers(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { status, search, page = 1, limit = 20 } = req.query
    const where: Record<string, unknown> = {}
    if (status) where.status = status
    if (search) {
      where.OR = [
        { name:  { contains: search as string, mode: 'insensitive' } },
        { email: { contains: search as string, mode: 'insensitive' } },
      ]
    }
    const skip = (Number(page) - 1) * Number(limit)
    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where,
        orderBy: { created_at: 'desc' },
        skip,
        take: Number(limit),
        select: {
          id: true, name: true, email: true, phone: true, company: true,
          account_type: true, auth_provider: true, has_email_password: true,
          is_email_verified: true, status: true, last_login_at: true,
          created_at: true, updated_at: true,
        },
      }),
      prisma.user.count({ where }),
    ])
    res.json({ success: true, data: users, total, page: Number(page), pages: Math.ceil(total / Number(limit)) })
  } catch (err) {
    next(err)
  }
}

export async function adminListCelebrities(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { industry, search, page = 1, limit = 50 } = req.query
    const where: Record<string, unknown> = {}
    if (industry && industry !== 'all') where.industry = industry
    if (search) {
      where.OR = [
        { name:    { contains: search as string, mode: 'insensitive' } },
        { name_ar: { contains: search as string, mode: 'insensitive' } },
      ]
    }
    const skip = (Number(page) - 1) * Number(limit)
    const [raw, total] = await Promise.all([
      prisma.celebrity.findMany({
        where,
        orderBy: [{ is_featured: 'desc' }, { is_active: 'desc' }, { total_orders: 'desc' }],
        skip,
        take: Number(limit),
        include: {
          portal_admin: {
            select: {
              id: true,
              email: true,
              is_active: true,
            },
          },
        },
      }),
      prisma.celebrity.count({ where }),
    ])
    const data = await Promise.all(raw.map(async c => ({
      ...c,
      thumbnail_url: await s3Service.presignIfS3(c.thumbnail_url ?? undefined),
    })))
    res.json({ success: true, data, total, page: Number(page), pages: Math.ceil(total / Number(limit)) })
  } catch (err) {
    next(err)
  }
}

export async function portalForgotPassword(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { email } = req.body
    const normalizedEmail = String(email || '').trim().toLowerCase()

    // 1. Try Admin table
    const admin = await prisma.admin.findUnique({ where: { email: normalizedEmail } })
    if (admin) {
      const resetToken = uuidv4()
      await prisma.admin.update({
        where: { id: admin.id },
        data: {
          password_reset_token:   resetToken,
          password_reset_expires: new Date(Date.now() + 60 * 60 * 1000),
        },
      })
      emailService.sendAdminPasswordResetEmail(normalizedEmail, admin.name, resetToken).catch(() => null)
      res.json({ success: true, message: 'If this email is registered, a reset link has been sent.' })
      return
    }

    // 2. Try Manager table
    const manager = await prisma.manager.findUnique({ where: { email: normalizedEmail } })
    if (manager) {
      const resetToken = uuidv4()
      await prisma.manager.update({
        where: { id: manager.id },
        data: {
          password_reset_token: resetToken,
          password_reset_expires: new Date(Date.now() + 60 * 60 * 1000),
        },
      })
      emailService.sendManagerPasswordResetEmail(normalizedEmail, manager.name, resetToken).catch(() => null)
      res.json({ success: true, message: 'If this email is registered, a reset link has been sent.' })
      return
    }

    res.json({ success: true, message: 'If this email is registered, a reset link has been sent.' })
  } catch (err) {
    next(err)
  }
}

export async function portalResetPassword(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { token } = req.params
    const { password } = req.body

    // 1. Try Admin table
    const admin = await prisma.admin.findFirst({
      where: {
        password_reset_token:   token,
        password_reset_expires: { gt: new Date() },
      },
    })

    if (admin) {
      const hashedPassword = await bcrypt.hash(password, 12)
      await prisma.admin.update({
        where: { id: admin.id },
        data: {
          password:               hashedPassword,
          must_change_password:   false,
          password_reset_token:   null,
          password_reset_expires: null,
        },
      })
      res.json({ success: true, message: 'Password reset successfully. You can now sign in.' })
      return
    }

    // 2. Try Manager table
    const manager = await prisma.manager.findFirst({
      where: {
        password_reset_token: token,
        password_reset_expires: { gt: new Date() },
      },
    })

    if (manager) {
      const hashedPassword = await bcrypt.hash(password, 12)
      await prisma.manager.update({
        where: { id: manager.id },
        data: {
          password: hashedPassword,
          must_change_password: false,
          password_reset_token: null,
          password_reset_expires: null,
        },
      })
      res.json({ success: true, message: 'Password reset successfully. You can now sign in.' })
      return
    }

    throw new AppError('Invalid or expired reset token', 400)
  } catch (err) {
    next(err)
  }
}

export async function updateUserStatus(req: AdminRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { status, reason } = req.body
    const target = await prisma.user.findUnique({
      where: { id: req.params.id },
      select: { id: true, name: true, email: true, status: true },
    })
    if (!target) throw new AppError('User not found', 404)

    const updateData: Record<string, unknown> = { status }
    if (status === 'blocked') {
      updateData.suspension_reason     = reason ?? null
      updateData.suspended_at          = new Date()
      updateData.suspended_by_admin_id = req.adminId
    } else {
      updateData.suspension_reason     = null
      updateData.suspended_at          = null
      updateData.suspended_by_admin_id = null
    }

    const user = await prisma.user.update({
      where: { id: req.params.id },
      data:  updateData,
      select: { id: true, name: true, email: true, status: true, suspension_reason: true, suspended_at: true, created_at: true, updated_at: true },
    })

    const actor = await prisma.admin.findUnique({ where: { id: req.adminId }, select: { name: true, role: true } })
    await auditLogService.log({
      actorId:    req.adminId!,
      actorName:  actor?.name ?? 'Admin',
      actorRole:  actor?.role ?? 'admin',
      action:     `user.${status}`,
      targetType: 'user',
      targetId:   target.id,
      targetName: target.name,
      reason,
      metadata:   { previousStatus: target.status, newStatus: status },
    })

    if (status === 'blocked') {
      emailService.sendAccountSuspendedEmail(target.email, target.name, reason).catch(() => null)
    }

    res.json({ success: true, data: user, message: `User ${status}` })
  } catch (err) {
    next(err)
  }
}

export async function getUserDetail(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.params.id },
      select: {
        id: true, name: true, email: true, phone: true, company: true,
        account_type: true, auth_provider: true, has_email_password: true,
        is_email_verified: true, status: true, last_login_at: true,
        suspension_reason: true, suspended_at: true, suspended_by_admin_id: true,
        created_at: true, updated_at: true,
      },
    })
    if (!user) throw new AppError('User not found', 404)
    res.json({ success: true, data: user })
  } catch (err) {
    next(err)
  }
}

export async function listAuditLogs(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { action, targetType, actorId, from, to, page = 1, limit = 20 } = req.query
    const result = await auditLogService.listAll(
      {
        action:     action as string | undefined,
        targetType: targetType as string | undefined,
        actorId:    actorId as string | undefined,
        from:       from ? new Date(from as string) : undefined,
        to:         to   ? new Date(to as string)   : undefined,
      },
      Number(page),
      Number(limit),
    )
    res.json({ success: true, ...result })
  } catch (err) {
    next(err)
  }
}

export async function getUserAuditLogs(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { page = 1, limit = 20 } = req.query
    const result = await auditLogService.listForTarget(req.params.id, Number(page), Number(limit))
    res.json({ success: true, ...result })
  } catch (err) {
    next(err)
  }
}
