import { Response, NextFunction } from 'express'
import prisma from '../lib/prisma'
import { AppError } from '../middleware/errorHandler'
import { auditLogService } from '../services/auditLog.service'
import { AdminRequest } from '../middleware/adminAuth'
import { createOrRefreshManagerAccount, ensureManagerLink } from '../services/managerAccess.service'

function normalizePermissions(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((item) => String(item).trim()).filter(Boolean)
    : []
}

function managerSelect() {
  return {
    id: true,
    name: true,
    email: true,
    phone: true,
    agency_name: true,
    is_active: true,
    must_change_password: true,
  }
}

async function logManagerAction(params: {
  adminId: string
  action: string
  celebrityId: string
  celebrityName: string
  managerName: string
  metadata?: Record<string, unknown>
}) {
  const actor = await prisma.admin.findUnique({
    where: { id: params.adminId },
    select: { name: true, role: true },
  })
  await auditLogService.log({
    actorId: params.adminId,
    actorName: actor?.name ?? 'Admin',
    actorRole: actor?.role ?? 'admin',
    action: params.action,
    targetType: 'celebrity',
    targetId: params.celebrityId,
    targetName: params.celebrityName,
    metadata: {
      manager_name: params.managerName,
      ...(params.metadata ?? {}),
    },
  })
}

export async function listManagers(_req: AdminRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const managers = await prisma.manager.findMany({
      orderBy: { name: 'asc' },
      select: {
        ...managerSelect(),
        celebrity_links: {
          where: { is_active: true },
          select: {
            celebrity: { select: { id: true, name: true } },
            permissions: true,
          },
        },
      },
    })
    res.json({ success: true, data: managers })
  } catch (err) {
    next(err)
  }
}

export async function listManagerLinks(req: AdminRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { celebrity_id } = req.params
    const links = await prisma.celebrityManagerLink.findMany({
      where: { celebrity_id, manager_id: { not: null } },
      include: {
        manager: { select: managerSelect() },
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
    const {
      manager_id,
      manager_name,
      manager_email,
      manager_phone,
      agency_name,
      permissions = [],
      notes,
    } = req.body

    const celebrity = await prisma.celebrity.findUnique({
      where: { id: celebrity_id },
      select: { id: true, name: true },
    })
    if (!celebrity) throw new AppError('Celebrity not found', 404)

    const normalizedPermissions = normalizePermissions(permissions)
    if (normalizedPermissions.length === 0) {
      throw new AppError('Select at least one manager permission', 400)
    }

    let managerId = String(manager_id || '').trim()
    let managerName = ''

    if (managerId) {
      const manager = await prisma.manager.findUnique({
        where: { id: managerId },
        select: managerSelect(),
      })
      if (!manager) throw new AppError('Manager not found', 404)
      managerName = manager.name
    } else {
      if (!String(manager_name || '').trim()) throw new AppError('Manager name is required', 400)
      if (!String(manager_email || '').trim()) throw new AppError('Manager email is required', 400)

      const { manager } = await createOrRefreshManagerAccount({
        name: String(manager_name),
        email: String(manager_email),
        phone: String(manager_phone || ''),
        agencyName: String(agency_name || ''),
      })
      managerId = manager.id
      managerName = manager.name
    }

    const link = await ensureManagerLink({
      celebrityId: celebrity_id,
      managerId,
      permissions: normalizedPermissions,
      linkedBy: req.adminId,
      notes: String(notes || '').trim() || null,
    })

    await logManagerAction({
      adminId: req.adminId!,
      action: 'celebrity.manager_linked',
      celebrityId: celebrity_id,
      celebrityName: celebrity.name,
      managerName: managerName || link.manager?.name || 'Manager',
      metadata: { permissions: normalizedPermissions },
    })

    res.status(201).json({ success: true, data: link, message: 'Manager linked successfully.' })
  } catch (err) {
    next(err)
  }
}

export async function createManagerAndBulkLink(req: AdminRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const {
      manager_id,
      name,
      email,
      phone,
      agency_name,
      permissions = [],
      celebrity_ids = [],
      notes,
    } = req.body

    const celebrityIds = Array.isArray(celebrity_ids)
      ? celebrity_ids.map((value) => String(value).trim()).filter(Boolean)
      : []
    if (celebrityIds.length === 0) throw new AppError('Select at least one celebrity', 400)

    const normalizedPermissions = normalizePermissions(permissions)
    if (normalizedPermissions.length === 0) throw new AppError('Select at least one manager permission', 400)

    let manager = manager_id
      ? await prisma.manager.findUnique({ where: { id: String(manager_id) } })
      : null

    if (!manager) {
      if (!String(name || '').trim()) throw new AppError('Manager name is required', 400)
      if (!String(email || '').trim()) throw new AppError('Manager email is required', 400)
      const created = await createOrRefreshManagerAccount({
        name: String(name),
        email: String(email),
        phone: String(phone || ''),
        agencyName: String(agency_name || ''),
      })
      manager = created.manager
    }

    const celebrities = await prisma.celebrity.findMany({
      where: { id: { in: celebrityIds } },
      select: { id: true, name: true },
    })
    if (celebrities.length !== celebrityIds.length) throw new AppError('One or more celebrities were not found', 404)

    const links = await Promise.all(celebrities.map((celebrity) => ensureManagerLink({
      celebrityId: celebrity.id,
      managerId: manager!.id,
      permissions: normalizedPermissions,
      linkedBy: req.adminId,
      notes: String(notes || '').trim() || null,
    })))

    await Promise.all(celebrities.map((celebrity) => logManagerAction({
      adminId: req.adminId!,
      action: 'celebrity.manager_linked',
      celebrityId: celebrity.id,
      celebrityName: celebrity.name,
      managerName: manager!.name,
      metadata: { permissions: normalizedPermissions },
    })))

    res.status(201).json({ success: true, data: links, message: 'Manager linked successfully.' })
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
      include: {
        manager: { select: managerSelect() },
        celebrity: { select: { id: true, name: true } },
      },
    })
    if (!existing || !existing.manager) throw new AppError('Manager link not found', 404)

    const updated = await prisma.celebrityManagerLink.update({
      where: { id: link_id },
      data: {
        permissions: normalizePermissions(permissions),
        is_active: typeof is_active === 'boolean' ? is_active : existing.is_active,
        notes: typeof notes === 'string' ? notes.trim() || null : existing.notes,
      },
      include: {
        manager: { select: managerSelect() },
        celebrity: { select: { id: true, name: true, thumbnail_url: true, is_active: true } },
      },
    })

    await logManagerAction({
      adminId: req.adminId!,
      action: updated.is_active ? 'celebrity.manager_permissions_updated' : 'celebrity.manager_unlinked',
      celebrityId: celebrity_id,
      celebrityName: existing.celebrity.name,
      managerName: existing.manager.name,
      metadata: { permissions: updated.permissions, is_active: updated.is_active },
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
      include: {
        manager: { select: managerSelect() },
        celebrity: { select: { id: true, name: true } },
      },
    })
    if (!existing || !existing.manager) throw new AppError('Manager link not found', 404)

    await prisma.celebrityManagerLink.delete({ where: { id: link_id } })

    await logManagerAction({
      adminId: req.adminId!,
      action: 'celebrity.manager_removed',
      celebrityId: celebrity_id,
      celebrityName: existing.celebrity.name,
      managerName: existing.manager.name,
    })

    res.json({ success: true, message: 'Manager link removed.' })
  } catch (err) {
    next(err)
  }
}

export async function listAllManagerLinks(req: AdminRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { search, page = 1, limit = 20 } = req.query
    const where: Record<string, unknown> = { manager_id: { not: null } }
    if (search) {
      where.OR = [
        { celebrity: { name: { contains: search as string, mode: 'insensitive' } } },
        { manager: { name: { contains: search as string, mode: 'insensitive' } } },
        { manager: { email: { contains: search as string, mode: 'insensitive' } } },
      ]
    }
    const skip = (Number(page) - 1) * Number(limit)
    const [links, total] = await Promise.all([
      prisma.celebrityManagerLink.findMany({
        where,
        include: {
          celebrity: { select: { id: true, name: true, thumbnail_url: true, is_active: true } },
          manager: { select: managerSelect() },
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
