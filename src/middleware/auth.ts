import { Request, Response, NextFunction } from 'express'
import jwt from 'jsonwebtoken'
import { env } from '../config/env'
import { User } from '../models/User'

export interface AuthRequest extends Request {
  userId?: string
  userEmail?: string
}

export async function requireAuth(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  const token = req.headers.authorization?.startsWith('Bearer ')
    ? req.headers.authorization.slice(7)
    : null

  if (!token) {
    res.status(401).json({ success: false, message: 'Authentication required' })
    return
  }

  try {
    const decoded = jwt.verify(token, env.jwt.secret) as { userId: string; email: string }
    const user = await User.findById(decoded.userId).select('status')
    if (!user || user.status === 'blocked') {
      res.status(401).json({ success: false, message: 'Account is not active' })
      return
    }
    req.userId = decoded.userId
    req.userEmail = decoded.email
    next()
  } catch {
    res.status(401).json({ success: false, message: 'Invalid or expired token' })
  }
}
