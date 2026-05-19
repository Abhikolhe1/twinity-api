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
      select: { isActive: true, role: true, roleId: true },
    })
    if (!admin || !admin.isActive) {
      res.status(401).json({ success: false, message: 'Admin account is not active' })
      return
    }

    req.adminId = decoded.adminId
    // Normalise Prisma enum value (super_admin) back to the hyphenated form used in tokens
    req.adminRole = (decoded.role as string).replace('_', '-') as AdminRole

    // Resolve permissions
    if (admin.role === 'super_admin') {
      req.adminPermissions = [...ALL_PERMISSIONS]
    } else if (admin.roleId) {
      const role = await prisma.role.findUnique({ where: { id: admin.roleId }, select: { permissions: true } })
      req.adminPermissions = role?.permissions ?? []
    } else {
      // Legacy fallback
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
