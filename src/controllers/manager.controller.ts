import bcrypt from 'bcryptjs'
import { Request, Response, NextFunction } from 'express'
import jwt from 'jsonwebtoken'
import { v4 as uuidv4 } from 'uuid'
import prisma from '../lib/prisma'
import { AppError } from '../middleware/errorHandler'
import { env } from '../config/env'
import { emailService } from '../services/email.service'
import { ManagerRequest } from '../middleware/managerAuth'

export async function managerLogin(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { email, password } = req.body
    const normalizedEmail = String(email || '').trim().toLowerCase()
    const manager = await prisma.manager.findUnique({
      where: { email: normalizedEmail },
    })

    if (!manager || !(await bcrypt.compare(password, manager.password))) {
      throw new AppError('Invalid credentials', 401)
    }
    if (!manager.is_active) throw new AppError('Manager account is not active', 403)

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
      manager: {
        id: manager.id,
        name: manager.name,
        email: manager.email,
        must_change_password: manager.must_change_password,
      },
    })
  } catch (err) {
    next(err)
  }
}

export async function managerForgotPassword(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const normalizedEmail = String(req.body?.email || '').trim().toLowerCase()
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
    }
    res.json({ success: true, message: 'If this email is registered, a reset link has been sent.' })
  } catch (err) {
    next(err)
  }
}

export async function managerResetPassword(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { token } = req.params
    const { password } = req.body
    const manager = await prisma.manager.findFirst({
      where: {
        password_reset_token: token,
        password_reset_expires: { gt: new Date() },
      },
    })
    if (!manager) throw new AppError('Invalid or expired reset token', 400)

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
  } catch (err) {
    next(err)
  }
}

export async function getManagerMe(req: ManagerRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const manager = await prisma.manager.findUnique({
      where: { id: req.managerId },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        agency_name: true,
        is_active: true,
        must_change_password: true,
        last_login_at: true,
      },
    })
    if (!manager) throw new AppError('Manager not found', 404)
    res.json({
      success: true,
      data: manager,
      permissions: ['manager.dashboard.view', ...(req.managerPermissions ?? [])],
    })
  } catch (err) {
    next(err)
  }
}
