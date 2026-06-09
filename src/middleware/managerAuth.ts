import { Request, Response, NextFunction } from 'express'
import jwt from 'jsonwebtoken'
import { env } from '../config/env'
import prisma from '../lib/prisma'

export interface ManagerRequest extends Request {
  managerId?: string
  managerPermissions?: string[]
}

export async function requireManager(req: ManagerRequest, res: Response, next: NextFunction): Promise<void> {
  const token = req.headers.authorization?.startsWith('Bearer ')
    ? req.headers.authorization.slice(7)
    : null

  if (!token) {
    res.status(401).json({ success: false, message: 'Manager authentication required' })
    return
  }

  try {
    const decoded = jwt.verify(token, env.adminJwtSecret) as { managerId?: string; portal?: string }
    if (!decoded.managerId || decoded.portal !== 'manager') {
      res.status(401).json({ success: false, message: 'Invalid manager token' })
      return
    }

    const manager = await prisma.manager.findUnique({
      where: { id: decoded.managerId },
      select: {
        id: true,
        is_active: true,
        celebrity_links: {
          where: { is_active: true },
          select: { permissions: true },
        },
      },
    })

    if (!manager || !manager.is_active) {
      res.status(401).json({ success: false, message: 'Manager account is not active' })
      return
    }

    req.managerId = manager.id
    req.managerPermissions = Array.from(new Set(manager.celebrity_links.flatMap((link) => link.permissions)))
    next()
  } catch {
    res.status(401).json({ success: false, message: 'Invalid or expired manager token' })
  }
}
