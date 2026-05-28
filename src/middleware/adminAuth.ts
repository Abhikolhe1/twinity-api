import { Request, Response, NextFunction } from 'express'
import jwt from 'jsonwebtoken'
import { env } from '../config/env'
import prisma from '../lib/prisma'
import { ALL_PERMISSIONS } from '../models/types'

export type AdminRole = 'super-admin' | 'admin' | 'ops'

export interface AdminRequest extends Request {
  adminId?: string
  adminRole?: AdminRole
  adminPermissions?: string[]
  celebrityId?: string | null
}

export async function requireAdmin(req: AdminRequest, res: Response, next: NextFunction): Promise<void> {
  const token = req.headers.authorization?.startsWith('Bearer ')
    ? req.headers.authorization.slice(7)
    : null

  if (!token) {
    res.status(401).json({ success: false, message: 'Admin authentication required' })
    return
  }

  try {
    const decoded = jwt.verify(token, env.adminJwtSecret) as { adminId: string; role: string }
    const admin = await prisma.admin.findUnique({
      where: { id: decoded.adminId },
      select: {
        is_active: true,
        role: true,
        role_id: true,
        celebrity_id: true,
        celebrity: { select: { onboarding_status: true } },
      },
    })
    if (!admin || !admin.is_active) {
      res.status(401).json({ success: false, message: 'Admin account is not active' })
      return
    }
    if (admin.celebrity_id && admin.celebrity?.onboarding_status !== 'approved') {
      res.status(401).json({ success: false, message: 'Celebrity portal access is not approved yet' })
      return
    }

    req.adminId = decoded.adminId
    req.adminRole = (decoded.role as string).replace('_', '-') as AdminRole
    req.celebrityId = admin.celebrity_id

    if (admin.role === 'super_admin') {
      req.adminPermissions = [...ALL_PERMISSIONS]
    } else if (admin.role_id) {
      const role = await prisma.role.findUnique({ where: { id: admin.role_id }, select: { permissions: true } })
      req.adminPermissions = role?.permissions ?? []
    } else {
      const roleStr = (admin.role as string).replace('_', '-')
      req.adminPermissions = roleStr === 'admin'
        ? ALL_PERMISSIONS.filter(p => !p.startsWith('roles') && !p.startsWith('team'))
        : ALL_PERMISSIONS.filter(p => p.endsWith('.view'))
    }

    next()
  } catch {
    res.status(401).json({ success: false, message: 'Invalid or expired admin token' })
  }
}

export function requireRole(...roles: AdminRole[]) {
  return (req: AdminRequest, res: Response, next: NextFunction): void => {
    if (!req.adminRole || !roles.includes(req.adminRole)) {
      res.status(403).json({ success: false, message: 'Insufficient permissions' })
      return
    }
    next()
  }
}

export function requirePermission(permission: string) {
  return (req: AdminRequest, res: Response, next: NextFunction): void => {
    if (req.adminRole === 'super-admin') { next(); return }
    if (!req.adminPermissions?.includes(permission)) {
      res.status(403).json({ success: false, message: `Permission denied: ${permission}` })
      return
    }
    next()
  }
}
