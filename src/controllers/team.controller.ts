import { Response, NextFunction } from 'express'
import bcrypt from 'bcryptjs'
import prisma from '../lib/prisma'
import { AdminRequest } from '../middleware/adminAuth'
import { AppError } from '../middleware/errorHandler'

const ADMIN_SELECT = {
  id: true, name: true, email: true, role: true, role_id: true, celebrity_id: true,
  is_active: true, must_change_password: true, profile_completed: true, last_login_at: true, created_at: true, updated_at: true,
}

export async function listTeamMembers(req: AdminRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const members = await prisma.admin.findMany({
      where: {
        id:   { not: req.adminId },
        role: { not: 'super_admin' },
        celebrity_id: null,
      },
      select: {
        ...ADMIN_SELECT,
        assigned_role: { select: { name: true, permissions: true } },
        celebrity: { select: { id: true, name: true, onboarding_status: true } },
      },
      orderBy: { created_at: 'desc' },
    })
    res.json({ success: true, data: members })
  } catch (err) {
    next(err)
  }
}

export async function getTeamMember(req: AdminRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const member = await prisma.admin.findUnique({
      where: { id: req.params.id },
      select: {
        ...ADMIN_SELECT,
        assigned_role: { select: { name: true, permissions: true } },
        celebrity: { select: { id: true, name: true, onboarding_status: true } },
      },
    })
    if (!member) throw new AppError('Team member not found', 404)
    res.json({ success: true, data: member })
  } catch (err) {
    next(err)
  }
}

export async function createTeamMember(req: AdminRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { name, email, password, roleId, role_id } = req.body
    if (!name || !email || !password) throw new AppError('Name, email and password are required', 400)
    if (password.length < 8) throw new AppError('Password must be at least 8 characters', 400)

    const existing = await prisma.admin.findUnique({ where: { email: email.toLowerCase() } })
    if (existing) throw new AppError('An account with this email already exists', 400)

    const assignedRoleId = role_id ?? roleId
    if (assignedRoleId) {
      const role = await prisma.role.findUnique({ where: { id: assignedRoleId } })
      if (!role) throw new AppError('Role not found', 404)
    }

    const hashedPassword = await bcrypt.hash(password, 12)
    const member = await prisma.admin.create({
      data: {
        name,
        email:     email.toLowerCase(),
        password:  hashedPassword,
        role_id:   assignedRoleId || undefined,
        role:      'ops',
        is_active: true,
      },
      select: {
        ...ADMIN_SELECT,
        assigned_role: { select: { name: true, permissions: true } },
      },
    })

    res.status(201).json({ success: true, data: member })
  } catch (err) {
    next(err)
  }
}

export async function updateTeamMember(req: AdminRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { name, roleId, role_id, isActive, is_active } = req.body
    const assignedRoleId = role_id ?? roleId
    const activeFlag = is_active ?? isActive

    if (assignedRoleId) {
      const role = await prisma.role.findUnique({ where: { id: assignedRoleId } })
      if (!role) throw new AppError('Role not found', 404)
    }

    const updateData: Record<string, unknown> = {}
    if (name) updateData.name = name
    if (assignedRoleId !== undefined) updateData.role_id  = assignedRoleId
    if (activeFlag      !== undefined) updateData.is_active = activeFlag

    const member = await prisma.admin.update({
      where: { id: req.params.id },
      data: updateData,
      select: {
        ...ADMIN_SELECT,
        assigned_role: { select: { name: true, permissions: true } },
      },
    }).catch(() => null)

    if (!member) throw new AppError('Team member not found', 404)
    res.json({ success: true, data: member })
  } catch (err) {
    next(err)
  }
}

export async function deleteTeamMember(req: AdminRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const member = await prisma.admin.findUnique({ where: { id: req.params.id } })
    if (!member) throw new AppError('Team member not found', 404)
    if (member.id === req.adminId) throw new AppError('You cannot delete your own account', 400)

    await prisma.admin.delete({ where: { id: req.params.id } })
    res.json({ success: true, message: 'Team member removed' })
  } catch (err) {
    next(err)
  }
}

export async function getMe(req: AdminRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const admin = await prisma.admin.findUnique({
      where: { id: req.adminId },
      select: {
        ...ADMIN_SELECT,
        assigned_role: { select: { name: true, permissions: true } },
        celebrity: {
          select: {
            id: true,
            name: true,
            onboarding_status: true,
            thumbnail_url: true,
          },
        },
      },
    })
    if (!admin) throw new AppError('Admin not found', 404)
    res.json({ success: true, data: admin, permissions: req.adminPermissions })
  } catch (err) {
    next(err)
  }
}
