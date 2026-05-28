import prisma from '../lib/prisma'
import { OtpType } from '@prisma/client'

const OTP_TTL_MINUTES = 10
const MAX_ATTEMPTS = 5

function generateCode(): string {
  return String(Math.floor(100000 + Math.random() * 900000))
}

export const otpService = {
  async create(email: string, type: OtpType, userId?: string): Promise<string> {
    // Invalidate any existing unused OTPs of the same type for this email
    await prisma.otpCode.updateMany({
      where: { email, type, used: false },
      data:  { used: true },
    })

    const code      = generateCode()
    const expiresAt = new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000)

    await prisma.otpCode.create({
      data: { email, code, type, expires_at: expiresAt, user_id: userId ?? null },
    })

    return code
  },

  async verify(email: string, code: string, type: OtpType): Promise<boolean> {
    const otp = await prisma.otpCode.findFirst({
      where: { email, type, used: false, expires_at: { gt: new Date() } },
      orderBy: { created_at: 'desc' },
    })

    if (!otp) return false

    if (otp.attempts >= MAX_ATTEMPTS) {
      await prisma.otpCode.update({ where: { id: otp.id }, data: { used: true } })
      return false
    }

    if (otp.code !== code) {
      await prisma.otpCode.update({ where: { id: otp.id }, data: { attempts: { increment: 1 } } })
      return false
    }

    await prisma.otpCode.update({ where: { id: otp.id }, data: { used: true } })
    return true
  },

  async isRateLimited(email: string, type: OtpType): Promise<boolean> {
    const recentCount = await prisma.otpCode.count({
      where: {
        email,
        type,
        created_at: { gt: new Date(Date.now() - 60 * 60 * 1000) },
      },
    })
    return recentCount >= 10
  },
}
