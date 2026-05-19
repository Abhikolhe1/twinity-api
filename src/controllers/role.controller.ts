import { Response, NextFunction } from 'express'
import prisma from '../lib/prisma'
import { AdminRequest } from '../middleware/adminAuth'
import { AppError } from '../middleware/errorHandler'

export async function listRoles(req: AdminRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const roles = await prisma.role.findMany({
      orderBy: [{ isSystem: 'desc' }, { createdAt: 'desc' }],
      include: { creator: { select: { name: true, email: true } } },
    })

    const memberCounts = await prisma.admin.groupBy({
      by: ['roleId'],
      where: { roleId: { in: roles.map(r => r.id), not: null } },
      _count: { roleId: true },
    })
    const countMap = Object.fromEntries(
      memberCounts.filter(m => m.roleId).map(m => [m.roleId as string, m._count.roleId])
    )

    const data = roles.map(r => ({
      ...r,
      memberCount: countMap[r.id] ?? 0,
    }))

    res.json({ success: true, data })
  } catch (err) {
    next(err)
  }
}

export async function createRole(req: AdminRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { name, description, permissions } = req.body
    if (!name) throw new AppError('Role name is required', 400)

    const existing = await prisma.role.findFirst({
      where: { name: { equals: name, mode: 'insensitive' } },
    })
    if (existing) throw new AppError('A role with this name already exists', 400)

    const role = await prisma.role.create({
      data: {
        name,
        description: description || '',
        permissions:  permissions || [],
        createdBy:   req.adminId,
      },
    })

    res.status(201).json({ success: true, data: role })
  } catch (err) {
    next(err)
  }
}

export async function updateRole(req: AdminRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const role = await prisma.role.findUnique({ where: { id: req.params.id } })
    if (!role) throw new AppError('Role not found', 404)
    if (role.isSystem) throw new AppError('System roles cannot be modified', 400)

    const { name, description, permissions } = req.body
    const updateData: Record<string, unknown> = {}
    if (name) updateData.name = name
    if (description !== undefined) updateData.description = description
    if (Array.isArray(permissions)) updateData.permissions = permissions

    const updated = await prisma.role.update({ where: { id: role.id }, data: updateData })
    res.json({ success: true, data: updated })
  } catch (err) {
    next(err)
  }
}

export async function deleteRole(req: AdminRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const role = await prisma.role.findUnique({ where: { id: req.params.id } })
    if (!role) throw new AppError('Role not found', 404)
    if (role.isSystem) throw new AppError('System roles cannot be deleted', 400)

    const count = await prisma.admin.count({ where: { roleId: req.params.id } })
    if (count > 0) {
      throw new AppError(`${count} team member(s) are assigned this role. Reassign them first.`, 400)
    }

    await prisma.role.delete({ where: { id: req.params.id } })
    res.json({ success: true, message: 'Role deleted' })
  } catch (err) {
    next(err)
  }
}
