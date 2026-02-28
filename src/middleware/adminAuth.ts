import { Request, Response, NextFunction } from 'express'
import jwt from 'jsonwebtoken'
import { env } from '../config/env'
import { Admin, AdminRole } from '../models/Admin'
import { Role, ALL_PERMISSIONS } from '../models/Role'

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
    const decoded = jwt.verify(token, env.adminJwtSecret) as { adminId: string; role: AdminRole }
    const admin = await Admin.findById(decoded.adminId).select('isActive role roleId')
    if (!admin || !admin.isActive) {
      res.status(401).json({ success: false, message: 'Admin account is not active' })
      return
    }

    req.adminId = decoded.adminId
    req.adminRole = decoded.role

    // Resolve permissions
    if (admin.role === 'super-admin') {
      req.adminPermissions = [...ALL_PERMISSIONS]
    } else if (admin.roleId) {
      const role = await Role.findById(admin.roleId).select('permissions')
      req.adminPermissions = role?.permissions ?? []
    } else {
      // Legacy fallback for hardcoded 'admin' / 'ops' roles
      req.adminPermissions = admin.role === 'admin'
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
