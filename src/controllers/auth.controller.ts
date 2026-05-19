import { Request, Response, NextFunction } from 'express'
import jwt from 'jsonwebtoken'
import bcrypt from 'bcryptjs'
import { v4 as uuidv4 } from 'uuid'
import prisma from '../lib/prisma'
import { env } from '../config/env'
import { AppError } from '../middleware/errorHandler'
import { emailService } from '../services/email.service'
import { AuthRequest } from '../middleware/auth'

function signToken(userId: string, email: string): string {
  return jwt.sign({ userId, email }, env.jwt.secret, { expiresIn: env.jwt.expiresIn as any })
}

export async function register(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { name, email, password, phone, company, accountType } = req.body

    const exists = await prisma.user.findUnique({ where: { email } })
    if (exists) throw new AppError('Email already registered', 409)

    const verificationToken = uuidv4()
    const hashedPassword = await bcrypt.hash(password, 12)

    const user = await prisma.user.create({
      data: {
        name,
        email,
        password: hashedPassword,
        phone,
        company,
        accountType: ['individual', 'influencer', 'agency'].includes(accountType) ? accountType : 'individual',
        authProvider: 'email',
        hasEmailPassword: true,
        emailVerificationToken: verificationToken,
        status: 'pending',
      },
    })

    emailService.sendVerificationEmail(email, name, verificationToken).catch(() => null)

    const token = signToken(user.id, user.email)
    res.status(201).json({
      success: true,
      message: 'Account created. Please verify your email.',
      token,
      user: { id: user.id, name: user.name, email: user.email, status: user.status },
    })
  } catch (err) {
    next(err)
  }
}

export async function login(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { email, password } = req.body
    const user = await prisma.user.findUnique({ where: { email }, select: {
      id: true, name: true, email: true, password: true, status: true,
      authProvider: true, hasEmailPassword: true, isEmailVerified: true,
    }})
    if (!user || !(await bcrypt.compare(password, user.password))) {
      throw new AppError('Invalid email or password', 401)
    }
    if (user.status === 'blocked') throw new AppError('Account has been blocked', 403)
    if (user.authProvider === 'email' && !user.hasEmailPassword) {
      throw new AppError('This account uses Google Sign-In. Please use the Google button to sign in.', 403)
    }
    // also handle google-only accounts
    if (user.authProvider === 'google' && !user.hasEmailPassword) {
      throw new AppError('This account uses Google Sign-In. Please use the Google button to sign in.', 403)
    }

    await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } })

    const token = signToken(user.id, user.email)
    res.json({
      success: true,
      token,
      user: { id: user.id, name: user.name, email: user.email, status: user.status, isEmailVerified: user.isEmailVerified },
    })
  } catch (err) {
    next(err)
  }
}

export async function verifyEmail(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { token } = req.params
    const user = await prisma.user.findFirst({ where: { emailVerificationToken: token } })
    if (!user) throw new AppError('Invalid or expired verification token', 400)

    await prisma.user.update({
      where: { id: user.id },
      data: {
        isEmailVerified: true,
        status: 'active',
        emailVerificationToken: null,
      },
    })

    res.json({ success: true, message: 'Email verified successfully' })
  } catch (err) {
    next(err)
  }
}

export async function forgotPassword(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { email } = req.body
    const user = await prisma.user.findUnique({ where: { email } })
    let resetUrl: string | undefined
    if (user) {
      const resetToken = uuidv4()
      await prisma.user.update({
        where: { id: user.id },
        data: {
          passwordResetToken: resetToken,
          passwordResetExpires: new Date(Date.now() + 60 * 60 * 1000),
        },
      })
      emailService.sendPasswordResetEmail(email, user.name, resetToken).catch(() => null)
      if (env.nodeEnv === 'development') {
        resetUrl = `${env.cors.clientUrl}/reset-password/${resetToken}`
      }
    }
    res.json({ success: true, message: 'If this email exists, a reset link has been sent.', ...(resetUrl ? { resetUrl } : {}) })
  } catch (err) {
    next(err)
  }
}

export async function resetPassword(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { token } = req.params
    const { password } = req.body
    const user = await prisma.user.findFirst({
      where: {
        passwordResetToken: token,
        passwordResetExpires: { gt: new Date() },
      },
    })
    if (!user) throw new AppError('Invalid or expired reset token', 400)

    const hashedPassword = await bcrypt.hash(password, 12)
    await prisma.user.update({
      where: { id: user.id },
      data: {
        password: hashedPassword,
        passwordResetToken: null,
        passwordResetExpires: null,
      },
    })

    res.json({ success: true, message: 'Password reset successfully' })
  } catch (err) {
    next(err)
  }
}

export async function googleAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { accessToken } = req.body
    if (!accessToken) throw new AppError('Access token required', 400)

    const googleRes = await fetch(`https://www.googleapis.com/oauth2/v3/userinfo?access_token=${accessToken}`)
    if (!googleRes.ok) throw new AppError('Failed to verify Google token', 401)
    const googleUser = await googleRes.json() as { sub: string; email: string; name: string; picture?: string }

    if (!googleUser.email) throw new AppError('Google account has no email', 400)

    let user = await prisma.user.findUnique({ where: { email: googleUser.email } })
    if (!user) {
      const hashedPassword = await bcrypt.hash(uuidv4(), 12)
      user = await prisma.user.create({
        data: {
          name: googleUser.name || googleUser.email.split('@')[0],
          email: googleUser.email,
          password: hashedPassword,
          authProvider: 'google',
          hasEmailPassword: false,
          isEmailVerified: true,
          status: 'active',
          avatarUrl: googleUser.picture,
        },
      })
    } else {
      if (user.authProvider === 'email') {
        throw new AppError('This email is registered with email & password. Please sign in with your email and password.', 403)
      }
      if (user.status === 'blocked') throw new AppError('Account has been blocked', 403)
      await prisma.user.update({
        where: { id: user.id },
        data: {
          lastLoginAt: new Date(),
          ...(googleUser.picture && !user.avatarUrl ? { avatarUrl: googleUser.picture } : {}),
        },
      })
      user = await prisma.user.findUnique({ where: { id: user.id } }) as typeof user
    }

    const token = signToken(user!.id, user!.email)
    res.json({
      success: true,
      token,
      user: { id: user!.id, name: user!.name, email: user!.email, status: user!.status, isEmailVerified: user!.isEmailVerified },
    })
  } catch (err) {
    next(err)
  }
}

export async function getMe(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.userId },
      select: {
        id: true, name: true, email: true, phone: true, company: true,
        avatarUrl: true, accountType: true, authProvider: true,
        hasEmailPassword: true, isEmailVerified: true, status: true,
        lastLoginAt: true, createdAt: true, updatedAt: true,
      },
    })
    if (!user) throw new AppError('User not found', 404)
    res.json({ success: true, user })
  } catch (err) {
    next(err)
  }
}

export async function setPassword(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { password } = req.body
    if (!password || typeof password !== 'string' || password.length < 8) {
      throw new AppError('Password must be at least 8 characters', 400)
    }

    const user = await prisma.user.findUnique({ where: { id: req.userId } })
    if (!user) throw new AppError('User not found', 404)

    const hashedPassword = await bcrypt.hash(password, 12)
    await prisma.user.update({
      where: { id: req.userId },
      data: { password: hashedPassword, hasEmailPassword: true },
    })

    res.json({ success: true, message: 'Password set successfully. You can now sign in with email and password.' })
  } catch (err) {
    next(err)
  }
}

export async function updateProfile(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { name, avatarUrl } = req.body

    const data: Record<string, unknown> = {}
    if (name && typeof name === 'string') data.name = name.trim()
    if (avatarUrl !== undefined) data.avatarUrl = avatarUrl

    if (Object.keys(data).length === 0) {
      res.json({ success: true, message: 'Nothing to update' })
      return
    }

    const user = await prisma.user.update({
      where: { id: req.userId },
      data,
      select: {
        id: true, name: true, email: true, phone: true, company: true,
        avatarUrl: true, accountType: true, authProvider: true,
        hasEmailPassword: true, isEmailVerified: true, status: true,
        lastLoginAt: true, createdAt: true, updatedAt: true,
      },
    })

    res.json({ success: true, user })
  } catch (err) {
    next(err)
  }
}
