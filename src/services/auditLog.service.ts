import prisma from '../lib/prisma'

export interface AuditLogEntry {
  actorId: string
  actorName: string
  actorRole: string
  action: string
  targetType: string
  targetId: string
  targetName?: string
  reason?: string
  metadata?: Record<string, unknown>
}

export const auditLogService = {
  async log(entry: AuditLogEntry): Promise<void> {
    await prisma.auditLog.create({
      data: {
        actor_id:    entry.actorId,
        actor_name:  entry.actorName,
        actor_role:  entry.actorRole,
        action:      entry.action,
        target_type: entry.targetType,
        target_id:   entry.targetId,
        target_name: entry.targetName,
        reason:      entry.reason,
        metadata:    (entry.metadata ?? {}) as object,
      },
    })
  },

  async listForTarget(targetId: string, page = 1, limit = 20) {
    const skip = (page - 1) * limit
    const [logs, total] = await Promise.all([
      prisma.auditLog.findMany({
        where: { target_id: targetId },
        orderBy: { created_at: 'desc' },
        skip,
        take: limit,
      }),
      prisma.auditLog.count({ where: { target_id: targetId } }),
    ])
    return { logs, total, page, pages: Math.ceil(total / limit) }
  },

  async listAll(filters: { action?: string; targetType?: string; actorId?: string; from?: Date; to?: Date }, page = 1, limit = 20) {
    const where: Record<string, unknown> = {}
    if (filters.action)     where.action      = { contains: filters.action, mode: 'insensitive' }
    if (filters.targetType) where.target_type = filters.targetType
    if (filters.actorId)    where.actor_id    = filters.actorId
    if (filters.from || filters.to) {
      where.created_at = {
        ...(filters.from ? { gte: filters.from } : {}),
        ...(filters.to   ? { lte: filters.to }   : {}),
      }
    }
    const skip = (page - 1) * limit
    const [logs, total] = await Promise.all([
      prisma.auditLog.findMany({ where, orderBy: { created_at: 'desc' }, skip, take: limit }),
      prisma.auditLog.count({ where }),
    ])
    return { logs, total, page, pages: Math.ceil(total / limit) }
  },
}
