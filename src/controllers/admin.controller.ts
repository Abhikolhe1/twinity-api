import { Request, Response, NextFunction } from 'express'
import jwt from 'jsonwebtoken'
import { v4 as uuidv4 } from 'uuid'
import { Admin } from '../models/Admin'
import { User } from '../models/User'
import { VideoJob } from '../models/VideoJob'
import { Lead } from '../models/Lead'
import { Celebrity } from '../models/Celebrity'
import { AppError } from '../middleware/errorHandler'
import { emailService } from '../services/email.service'
import { env } from '../config/env'

// Admin login
export async function adminLogin(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { email, password } = req.body
    const admin = await Admin.findOne({ email }).select('+password')
    if (!admin || !(await admin.comparePassword(password))) {
      throw new AppError('Invalid credentials', 401)
    }
    if (!admin.isActive) throw new AppError('Admin account is not active', 403)

    admin.lastLoginAt = new Date()
    await admin.save({ validateBeforeSave: false })

    const token = jwt.sign(
      { adminId: String(admin._id), role: admin.role },
      env.adminJwtSecret,
      { expiresIn: '12h' }
    )

    res.json({
      success: true,
      token,
      admin: { id: admin._id, name: admin.name, email: admin.email, role: admin.role },
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
      User.countDocuments(),
      VideoJob.countDocuments(),
      Lead.countDocuments(),
      Celebrity.countDocuments({ isActive: true }),
      VideoJob.countDocuments({ status: 'pending' }),
      Lead.countDocuments({ status: { $in: ['new', 'contacted', 'negotiating'] } }),
      VideoJob.find().sort({ createdAt: -1 }).limit(5)
        .populate('userId', 'name email')
        .populate('celebrityId', 'name initials'),
      Lead.find().sort({ createdAt: -1 }).limit(5),
    ])

    const revenueResult = await Lead.aggregate([
      { $match: { status: 'paid' } },
      { $group: { _id: null, total: { $sum: '$estimatedValue' } } },
    ])
    const totalRevenue = revenueResult[0]?.total ?? 0

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
    const filter: Record<string, unknown> = {}
    if (status) filter.status = status
    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
      ]
    }
    const skip = (Number(page) - 1) * Number(limit)
    const [users, total] = await Promise.all([
      User.find(filter).sort({ createdAt: -1 }).skip(skip).limit(Number(limit)),
      User.countDocuments(filter),
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
    const filter: Record<string, unknown> = {}
    if (industry && industry !== 'all') filter.industry = industry
    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: 'i' } },
        { nameAr: { $regex: search, $options: 'i' } },
      ]
    }
    const skip = (Number(page) - 1) * Number(limit)
    const [celebrities, total] = await Promise.all([
      Celebrity.find(filter).sort({ isFeatured: -1, isActive: -1, totalOrders: -1 }).skip(skip).limit(Number(limit)),
      Celebrity.countDocuments(filter),
    ])
    res.json({ success: true, data: celebrities, total, page: Number(page), pages: Math.ceil(total / Number(limit)) })
  } catch (err) {
    next(err)
  }
}

// Admin forgot password
export async function adminForgotPassword(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { email } = req.body
    const admin = await Admin.findOne({ email })
    // Always respond OK to prevent email enumeration
    if (admin) {
      const resetToken = uuidv4()
      admin.passwordResetToken   = resetToken
      admin.passwordResetExpires = new Date(Date.now() + 60 * 60 * 1000) // 1 hour
      await admin.save({ validateBeforeSave: false })
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
    const admin = await Admin.findOne({
      passwordResetToken:   token,
      passwordResetExpires: { $gt: Date.now() },
    }).select('+passwordResetToken +passwordResetExpires')

    if (!admin) throw new AppError('Invalid or expired reset token', 400)

    admin.password             = password
    admin.passwordResetToken   = undefined
    admin.passwordResetExpires = undefined
    await admin.save()

    res.json({ success: true, message: 'Password reset successfully. You can now sign in.' })
  } catch (err) {
    next(err)
  }
}

export async function updateUserStatus(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { status } = req.body
    const user = await User.findByIdAndUpdate(req.params.id, { status }, { new: true })
    if (!user) throw new AppError('User not found', 404)
    res.json({ success: true, data: user, message: `User ${status}` })
  } catch (err) {
    next(err)
  }
}
