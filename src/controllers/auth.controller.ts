import { Request, Response, NextFunction } from 'express'
import jwt from 'jsonwebtoken'
import { v4 as uuidv4 } from 'uuid'
import { User } from '../models/User'
import { env } from '../config/env'
import { AppError } from '../middleware/errorHandler'
import { emailService } from '../services/email.service'

function signToken(userId: string, email: string): string {
  return jwt.sign({ userId, email }, env.jwt.secret, { expiresIn: env.jwt.expiresIn as any })
}

export async function register(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { name, email, password, phone, company } = req.body

    const exists = await User.findOne({ email })
    if (exists) throw new AppError('Email already registered', 409)

    const verificationToken = uuidv4()
    const user = await User.create({
      name, email, password, phone, company,
      emailVerificationToken: verificationToken,
      status: 'pending',
    })

    // Send verification email (non-blocking)
    emailService.sendVerificationEmail(email, name, verificationToken).catch(() => null)

    const token = signToken(String(user._id), user.email)
    res.status(201).json({
      success: true,
      message: 'Account created. Please verify your email.',
      token,
      user: { id: user._id, name: user.name, email: user.email, status: user.status },
    })
  } catch (err) {
    next(err)
  }
}

export async function login(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { email, password } = req.body
    const user = await User.findOne({ email }).select('+password')
    if (!user || !(await user.comparePassword(password))) {
      throw new AppError('Invalid email or password', 401)
    }
    if (user.status === 'blocked') throw new AppError('Account has been blocked', 403)

    user.lastLoginAt = new Date()
    await user.save({ validateBeforeSave: false })

    const token = signToken(String(user._id), user.email)
    res.json({
      success: true,
      token,
      user: { id: user._id, name: user.name, email: user.email, status: user.status, isEmailVerified: user.isEmailVerified },
    })
  } catch (err) {
    next(err)
  }
}

export async function verifyEmail(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { token } = req.params
    const user = await User.findOne({ emailVerificationToken: token }).select('+emailVerificationToken')
    if (!user) throw new AppError('Invalid or expired verification token', 400)

    user.isEmailVerified = true
    user.status = 'active'
    user.emailVerificationToken = undefined
    await user.save({ validateBeforeSave: false })

    res.json({ success: true, message: 'Email verified successfully' })
  } catch (err) {
    next(err)
  }
}

export async function forgotPassword(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { email } = req.body
    const user = await User.findOne({ email })
    // Always respond OK to prevent email enumeration
    if (user) {
      const resetToken = uuidv4()
      user.passwordResetToken = resetToken
      user.passwordResetExpires = new Date(Date.now() + 60 * 60 * 1000) // 1 hour
      await user.save({ validateBeforeSave: false })
      emailService.sendPasswordResetEmail(email, user.name, resetToken).catch(() => null)
    }
    res.json({ success: true, message: 'If this email exists, a reset link has been sent.' })
  } catch (err) {
    next(err)
  }
}

export async function resetPassword(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { token } = req.params
    const { password } = req.body
    const user = await User.findOne({
      passwordResetToken: token,
      passwordResetExpires: { $gt: Date.now() },
    }).select('+passwordResetToken +passwordResetExpires')

    if (!user) throw new AppError('Invalid or expired reset token', 400)

    user.password = password
    user.passwordResetToken = undefined
    user.passwordResetExpires = undefined
    await user.save()

    res.json({ success: true, message: 'Password reset successfully' })
  } catch (err) {
    next(err)
  }
}

export async function getMe(req: Request & { userId?: string }, res: Response, next: NextFunction): Promise<void> {
  try {
    const user = await User.findById(req.userId)
    if (!user) throw new AppError('User not found', 404)
    res.json({ success: true, user })
  } catch (err) {
    next(err)
  }
}
