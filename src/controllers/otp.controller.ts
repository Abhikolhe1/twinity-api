import { Request, Response, NextFunction } from 'express'
import { OtpType } from '@prisma/client'
import prisma from '../lib/prisma'
import { AppError } from '../middleware/errorHandler'
import { otpService } from '../services/otp.service'
import { emailService } from '../services/email.service'
import { AuthRequest } from '../middleware/auth'

export async function sendOtp(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { email, type } = req.body as { email: string; type: OtpType }
    if (!email || !type) throw new AppError('email and type are required', 400)

    if (await otpService.isRateLimited(email, type)) {
      throw new AppError('Too many OTP requests. Please wait before requesting again.', 429)
    }

    const user = await prisma.user.findUnique({ where: { email: email.trim().toLowerCase() }, select: { id: true, name: true } })
    const name = user?.name ?? 'User'

    const purposeMap: Partial<Record<OtpType, string>> = {
      email_verification: 'verify your email address',
      login_mfa:          'complete your login',
      password_reset_otp: 'reset your password',
    }
    const purpose = purposeMap[type] ?? 'verify your identity'

    const code = await otpService.create(email.trim().toLowerCase(), type, user?.id)
    await emailService.sendOtpEmail(email, name, code, purpose)

    res.json({ success: true, message: 'OTP sent to your email.' })
  } catch (err) {
    next(err)
  }
}

export async function verifyOtp(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { email, code, type } = req.body as { email: string; code: string; type: OtpType }
    if (!email || !code || !type) throw new AppError('email, code and type are required', 400)

    const valid = await otpService.verify(email.trim().toLowerCase(), code, type)
    if (!valid) throw new AppError('Invalid or expired OTP', 400)

    if (type === 'email_verification') {
      await prisma.user.updateMany({
        where: { email: email.trim().toLowerCase() },
        data:  { is_email_verified: true, status: 'active' },
      })
    }

    res.json({ success: true, message: 'OTP verified successfully.' })
  } catch (err) {
    next(err)
  }
}
