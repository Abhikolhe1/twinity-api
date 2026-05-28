import { Response, NextFunction } from 'express'
import prisma from '../lib/prisma'
import { AppError } from '../middleware/errorHandler'
import { auditLogService } from '../services/auditLog.service'
import { AdminRequest } from '../middleware/adminAuth'

export async function listManagerLinks(req: AdminRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { celebrity_id } = req.params
    const links = await prisma.celebrityManagerLink.findMany({
      where: { celebrity_id },
      include: {
        admin: { select: { id: true, name: true, email: true, role: true, last_login_at: true, is_active: true } },
      },
      orderBy: { created_at: 'desc' },
    })
    res.json({ success: true, data: links })
  } catch (err) {
    next(err)
  }
}

export async function createManagerLink(req: AdminRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { celebrity_id } = req.params
    const { admin_id, permissions = [], notes } = req.body

    const [celebrity, admin] = await Promise.all([
      prisma.celebrity.findUnique({ where: { id: celebrity_id }, select: { id: true, name: true } }),
      prisma.admin.findUnique({ where: { id: admin_id }, select: { id: true, name: true, role: true } }),
    ])
    if (!celebrity) throw new AppError('Celebrity not found', 404)
    if (!admin)     throw new AppError('Admin/manager not found', 404)

    const existing = await prisma.celebrityManagerLink.findUnique({
      where: { celebrity_id_admin_id: { celebrity_id, admin_id } },
    })
    if (existing) {
      const updated = await prisma.celebrityManagerLink.update({
        where: { celebrity_id_admin_id: { celebrity_id, admin_id } },
        data:  { permissions, is_active: true, notes, linked_by: req.adminId },
        include: { admin: { select: { id: true, name: true, email: true, role: true } } },
      })
      res.json({ success: true, data: updated, message: 'Manager link updated.' })
      return
    }

    const link = await prisma.celebrityManagerLink.create({
      data: { celebrity_id, admin_id, permissions, notes, linked_by: req.adminId, is_active: true },
      include: { admin: { select: { id: true, name: true, email: true, role: true } } },
    })

    const actor = await prisma.admin.findUnique({ where: { id: req.adminId }, select: { name: true, role: true } })
    await auditLogService.log({
      actorId:    req.adminId!,
      actorName:  actor?.name ?? 'Admin',
      actorRole:  actor?.role ?? 'admin',
      action:     'celebrity.manager_linked',
      targetType: 'celebrity',
      targetId:   celebrity_id,
      targetName: celebrity.name,
      metadata:   { admin_id, manager_name: admin.name, permissions },
    })

    res.status(201).json({ success: true, data: link, message: 'Manager linked successfully.' })
  } catch (err) {
    next(err)
  }
}

export async function updateManagerLink(req: AdminRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { celebrity_id, link_id } = req.params
    const { permissions, is_active, notes } = req.body

    const existing = await prisma.celebrityManagerLink.findFirst({
      where: { id: link_id, celebrity_id },
      include: { admin: { select: { name: true } }, celebrity: { select: { name: true } } },
    })
    if (!existing) throw new AppError('Manager link not found', 404)

    const updated = await prisma.celebrityManagerLink.update({
      where: { id: link_id },
      data:  { permissions, is_active, notes },
      include: { admin: { select: { id: true, name: true, email: true, role: true } } },
    })

    const actor = await prisma.admin.findUnique({ where: { id: req.adminId }, select: { name: true, role: true } })
    await auditLogService.log({
      actorId:    req.adminId!,
      actorName:  actor?.name ?? 'Admin',
      actorRole:  actor?.role ?? 'admin',
      action:     is_active === false ? 'celebrity.manager_unlinked' : 'celebrity.manager_permissions_updated',
      targetType: 'celebrity',
      targetId:   celebrity_id,
      targetName: existing.celebrity.name,
      metadata:   { manager_name: existing.admin.name, permissions, is_active },
    })

    res.json({ success: true, data: updated, message: 'Manager link updated.' })
  } catch (err) {
    next(err)
  }
}

export async function deleteManagerLink(req: AdminRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { celebrity_id, link_id } = req.params
    const existing = await prisma.celebrityManagerLink.findFirst({
      where: { id: link_id, celebrity_id },
      include: { admin: { select: { name: true } }, celebrity: { select: { name: true } } },
    })
    if (!existing) throw new AppError('Manager link not found', 404)

    await prisma.celebrityManagerLink.delete({ where: { id: link_id } })

    const actor = await prisma.admin.findUnique({ where: { id: req.adminId }, select: { name: true, role: true } })
    await auditLogService.log({
      actorId:    req.adminId!,
      actorName:  actor?.name ?? 'Admin',
      actorRole:  actor?.role ?? 'admin',
      action:     'celebrity.manager_removed',
      targetType: 'celebrity',
      targetId:   celebrity_id,
      targetName: existing.celebrity.name,
      metadata:   { manager_name: existing.admin.name },
    })

    res.json({ success: true, message: 'Manager link removed.' })
  } catch (err) {
    next(err)
  }
}

export async function listAllManagerLinks(req: AdminRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { search, page = 1, limit = 20 } = req.query
    const where: Record<string, unknown> = {}
    if (search) {
      where.OR = [
        { celebrity: { name: { contains: search as string, mode: 'insensitive' } } },
        { admin:     { name: { contains: search as string, mode: 'insensitive' } } },
      ]
    }
    const skip = (Number(page) - 1) * Number(limit)
    const [links, total] = await Promise.all([
      prisma.celebrityManagerLink.findMany({
        where,
        include: {
          celebrity: { select: { id: true, name: true, thumbnail_url: true, is_active: true } },
          admin:     { select: { id: true, name: true, email: true, role: true } },
        },
        orderBy: { created_at: 'desc' },
        skip,
        take: Number(limit),
      }),
      prisma.celebrityManagerLink.count({ where }),
    ])
    res.json({ success: true, data: links, total, page: Number(page), pages: Math.ceil(total / Number(limit)) })
  } catch (err) {
    next(err)
  }
}
