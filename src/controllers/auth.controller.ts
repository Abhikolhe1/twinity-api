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
      authProvider: 'email',
      hasEmailPassword: true,
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
    if (user.authProvider === 'google' && !user.hasEmailPassword) {
      throw new AppError('This account uses Google Sign-In. Please use the Google button to sign in.', 403)
    }

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
    let resetUrl: string | undefined
    // Always respond OK to prevent email enumeration
    if (user) {
      const resetToken = uuidv4()
      user.passwordResetToken = resetToken
      user.passwordResetExpires = new Date(Date.now() + 60 * 60 * 1000) // 1 hour
      await user.save({ validateBeforeSave: false })
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

export async function googleAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { accessToken } = req.body
    if (!accessToken) throw new AppError('Access token required', 400)

    // Fetch user info from Google
    const googleRes = await fetch(`https://www.googleapis.com/oauth2/v3/userinfo?access_token=${accessToken}`)
    if (!googleRes.ok) throw new AppError('Failed to verify Google token', 401)
    const googleUser = await googleRes.json() as { sub: string; email: string; name: string; picture?: string }

    if (!googleUser.email) throw new AppError('Google account has no email', 400)

    // Find or create user
    let user = await User.findOne({ email: googleUser.email })
    if (!user) {
      user = await User.create({
        name: googleUser.name || googleUser.email.split('@')[0],
        email: googleUser.email,
        password: uuidv4(), // random — real password only set via setPassword endpoint
        authProvider: 'google',
        hasEmailPassword: false,
        isEmailVerified: true,
        status: 'active',
        avatarUrl: googleUser.picture,
      })
    } else {
      if (user.authProvider === 'email') {
        throw new AppError('This email is registered with email & password. Please sign in with your email and password.', 403)
      }
      if (user.status === 'blocked') throw new AppError('Account has been blocked', 403)
      user.lastLoginAt = new Date()
      if (googleUser.picture && !user.avatarUrl) user.avatarUrl = googleUser.picture
      await user.save({ validateBeforeSave: false })
    }

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

export async function getMe(req: Request & { userId?: string }, res: Response, next: NextFunction): Promise<void> {
  try {
    const user = await User.findById(req.userId)
    if (!user) throw new AppError('User not found', 404)
    res.json({ success: true, user })
  } catch (err) {
    next(err)
  }
}

export async function setPassword(req: Request & { userId?: string }, res: Response, next: NextFunction): Promise<void> {
  try {
    const { password } = req.body
    if (!password || typeof password !== 'string' || password.length < 8) {
      throw new AppError('Password must be at least 8 characters', 400)
    }

    const user = await User.findById(req.userId).select('+password')
    if (!user) throw new AppError('User not found', 404)

    user.password = password
    user.hasEmailPassword = true
    await user.save()

    res.json({ success: true, message: 'Password set successfully. You can now sign in with email and password.' })
  } catch (err) {
    next(err)
  }
}

export async function updateProfile(req: Request & { userId?: string }, res: Response, next: NextFunction): Promise<void> {
  try {
    const { name, avatarUrl } = req.body

    const update: Record<string, unknown> = {}
    if (name && typeof name === 'string') update.name = name.trim()
    if (avatarUrl !== undefined) update.avatarUrl = avatarUrl

    if (Object.keys(update).length === 0) {
      res.json({ success: true, message: 'Nothing to update' })
      return
    }

    const user = await User.findByIdAndUpdate(
      req.userId,
      { $set: update },
      { new: true, runValidators: true }
    )
    if (!user) throw new AppError('User not found', 404)

    res.json({ success: true, user })
  } catch (err) {
    next(err)
  }
}
