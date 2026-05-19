import { Request, Response, NextFunction } from 'express'
import jwt from 'jsonwebtoken'
import bcrypt from 'bcryptjs'
import { v4 as uuidv4 } from 'uuid'
import prisma from '../lib/prisma'
import { AppError } from '../middleware/errorHandler'
import { emailService } from '../services/email.service'
import { s3Service } from '../services/s3.service'
import { env } from '../config/env'

// Admin login
export async function adminLogin(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { email, password } = req.body
    const admin = await prisma.admin.findUnique({ where: { email } })
    if (!admin || !(await bcrypt.compare(password, admin.password))) {
      throw new AppError('Invalid credentials', 401)
    }
    if (!admin.isActive) throw new AppError('Admin account is not active', 403)

    await prisma.admin.update({ where: { id: admin.id }, data: { lastLoginAt: new Date() } })

    const token = jwt.sign(
      { adminId: admin.id, role: admin.role },
      env.adminJwtSecret,
      { expiresIn: '12h' }
    )

    res.json({
      success: true,
      token,
      admin: { id: admin.id, name: admin.name, email: admin.email, role: admin.role },
    })
  } catch (err) {
    next(err)
  }
}

// Dashboard stats
export async function getDashboardStats(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const [totalUsers, totalVideos, totalLeads, totalCelebrities,
      pendingJobs, activeLeads, recentJobs, recentLeads] = await Promise.all([
      prisma.user.count(),
      prisma.videoJob.count(),
      prisma.lead.count(),
      prisma.celebrity.count({ where: { isActive: true } }),
      prisma.videoJob.count({ where: { status: 'pending' } }),
      prisma.lead.count({ where: { status: { in: ['new', 'contacted', 'negotiating'] } } }),
      prisma.videoJob.findMany({
        orderBy: { createdAt: 'desc' },
        take: 5,
        include: {
          user: { select: { name: true, email: true } },
          celebrity: { select: { name: true, initials: true } },
        },
      }),
      prisma.lead.findMany({
        orderBy: { createdAt: 'desc' },
        take: 5,
      }),
    ])

    const revenueAgg = await prisma.lead.aggregate({
      where: { status: 'paid' },
      _sum: { estimatedValue: true },
    })
    const totalRevenue = revenueAgg._sum.estimatedValue ?? 0

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

// User management
export async function listUsers(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { status, search, page = 1, limit = 20 } = req.query
    const where: Record<string, unknown> = {}
    if (status) where.status = status
    if (search) {
      where.OR = [
        { name: { contains: search as string, mode: 'insensitive' } },
        { email: { contains: search as string, mode: 'insensitive' } },
      ]
    }
    const skip = (Number(page) - 1) * Number(limit)
    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: Number(limit),
        select: {
          id: true, name: true, email: true, phone: true, company: true,
          accountType: true, authProvider: true, hasEmailPassword: true,
          isEmailVerified: true, status: true, lastLoginAt: true,
          createdAt: true, updatedAt: true,
        },
      }),
      prisma.user.count({ where }),
    ])
    res.json({ success: true, data: users, total, page: Number(page), pages: Math.ceil(total / Number(limit)) })
  } catch (err) {
    next(err)
  }
}

// Admin — list all celebrities (including inactive)
export async function adminListCelebrities(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { industry, search, page = 1, limit = 50 } = req.query
    const where: Record<string, unknown> = {}
    if (industry && industry !== 'all') where.industry = industry
    if (search) {
      where.OR = [
        { name: { contains: search as string, mode: 'insensitive' } },
        { nameAr: { contains: search as string, mode: 'insensitive' } },
      ]
    }
    const skip = (Number(page) - 1) * Number(limit)
    const [raw, total] = await Promise.all([
      prisma.celebrity.findMany({
        where,
        orderBy: [{ isFeatured: 'desc' }, { isActive: 'desc' }, { totalOrders: 'desc' }],
        skip,
        take: Number(limit),
      }),
      prisma.celebrity.count({ where }),
    ])
    const data = await Promise.all(raw.map(async c => ({
      ...c,
      thumbnailUrl: await s3Service.presignIfS3(c.thumbnailUrl ?? undefined),
    })))
    res.json({ success: true, data, total, page: Number(page), pages: Math.ceil(total / Number(limit)) })
  } catch (err) {
    next(err)
  }
}

// Admin forgot password
export async function adminForgotPassword(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { email } = req.body
    const admin = await prisma.admin.findUnique({ where: { email } })
    if (admin) {
      const resetToken = uuidv4()
      await prisma.admin.update({
        where: { id: admin.id },
        data: {
          passwordResetToken: resetToken,
          passwordResetExpires: new Date(Date.now() + 60 * 60 * 1000),
        },
      })
      emailService.sendAdminPasswordResetEmail(email, admin.name, resetToken).catch(() => null)
    }
    res.json({ success: true, message: 'If this email is registered, a reset link has been sent.' })
  } catch (err) {
    next(err)
  }
}

// Admin reset password
export async function adminResetPassword(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { token } = req.params
    const { password } = req.body
    const admin = await prisma.admin.findFirst({
      where: {
        passwordResetToken: token,
        passwordResetExpires: { gt: new Date() },
      },
    })
    if (!admin) throw new AppError('Invalid or expired reset token', 400)

    const hashedPassword = await bcrypt.hash(password, 12)
    await prisma.admin.update({
      where: { id: admin.id },
      data: {
        password: hashedPassword,
        passwordResetToken: null,
        passwordResetExpires: null,
      },
    })

    res.json({ success: true, message: 'Password reset successfully. You can now sign in.' })
  } catch (err) {
    next(err)
  }
}

export async function updateUserStatus(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { status } = req.body
    const user = await prisma.user.update({
      where: { id: req.params.id },
      data: { status },
      select: {
        id: true, name: true, email: true, status: true,
        createdAt: true, updatedAt: true,
      },
    })
    res.json({ success: true, data: user, message: `User ${status}` })
  } catch (err) {
    next(err)
  }
}
