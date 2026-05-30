import prisma from '../lib/prisma'
import { auditLogService } from './auditLog.service'

// ── Revision limits per product type (BRD §8.12) ──────────────────────────

export function getRevisionLimit(productType: string): number {
  switch (productType) {
    case 'video_ad':
    case 'video-ad':
      return 2   // Customized Commercial Ad (default video-ad maps to customized)
    case 'image_ad':
    case 'image-ad':
      return 2
    case 'greeting':
      return 1
    default:
      return 1
  }
}

// ── Minor vs Material classification (BRD §8.10 / §8.11) ─────────────────

const MATERIAL_KEYWORDS: string[] = [
  'change the brand',
  'different brand',
  'new brand',
  'change the product',
  'different product',
  'new product',
  'change the celebrity',
  'different celebrity',
  'new celebrity',
  'change the script',
  'rewrite the script',
  'full script',
  'marketing message',
  'change the message',
  'different message',
  'change platform',
  'different platform',
  'new platform',
  'change distribution',
  'change territory',
  'different country',
  'different territory',
  'change duration',
  'different duration',
  'extend the license',
  'change license',
  'convert to customized',
  'convert to template',
  'switch to customized',
  'switch to template',
  'change ad type',
  'different ad type',
  'change category',
  'different sector',
  'competitor brand',
  'medical claim',
  'financial claim',
  'legal claim',
  'regulated claim',
]

export function classifyRevision(reason: string): {
  classification: 'minor' | 'material'
  matchedKeyword: string | null
} {
  const lowerReason = reason.toLowerCase()
  const matched = MATERIAL_KEYWORDS.find(kw => lowerReason.includes(kw))
  return {
    classification: matched ? 'material' : 'minor',
    matchedKeyword: matched ?? null,
  }
}

// ── Get revision count + check if limit reached ────────────────────────────

export async function getJobRevisionState(jobId: string): Promise<{
  revisionCount: number
  revisionLimit: number
  limitReached: boolean
  isEscalated: boolean
}> {
  const job = await prisma.videoJob.findUnique({
    where: { id: jobId },
    select: { revision_count: true, revision_limit: true, is_escalated_to_support: true },
  })
  if (!job) throw new Error('Job not found')
  return {
    revisionCount: job.revision_count,
    revisionLimit: job.revision_limit,
    limitReached:  job.revision_count >= job.revision_limit,
    isEscalated:   job.is_escalated_to_support,
  }
}

// ── Create a revision record ───────────────────────────────────────────────

export async function createRevision(params: {
  jobId: string
  userId: string
  reason: string
  actorName: string
}) {
  const { jobId, userId, reason, actorName } = params

  const job = await prisma.videoJob.findUnique({
    where: { id: jobId },
    select: {
      id: true, reference_id: true, product_type: true,
      revision_count: true, revision_limit: true,
      is_escalated_to_support: true, status: true,
    },
  })
  if (!job) throw new Error('Job not found')
  if (job.is_escalated_to_support) throw new Error('This request has already been escalated to support')
  if (job.status !== 'review') throw new Error('Revision can only be requested when the preview is in review')
  if (job.revision_count >= job.revision_limit) throw new Error('Revision limit already reached for this request')

  const { classification, matchedKeyword } = classifyRevision(reason)

  if (classification === 'material') {
    await auditLogService.log({
      actorId:    userId,
      actorName,
      actorRole:  'client',
      action:     'revision.material_rejected',
      targetType: 'video_job',
      targetId:   jobId,
      targetName: job.reference_id,
      reason,
      metadata:   { classification: 'material', matchedKeyword },
    })
    return {
      accepted: false,
      classification: 'material' as const,
      matchedKeyword,
      message: 'This change is classified as a material change and cannot be processed as a revision. Please resubmit a new request.',
    }
  }

  const newCount = job.revision_count + 1
  const attemptNumber = newCount

  const [revision] = await Promise.all([
    prisma.previewRevision.create({
      data: {
        video_job_id:          jobId,
        attempt_number:        attemptNumber,
        type:                  'minor',
        reason,
        classification:        'minor',
        status:                'pending',
        submitted_by_user_id:  userId,
      },
    }),
    prisma.videoJob.update({
      where: { id: jobId },
      data:  { revision_count: newCount },
    }),
  ])

  await auditLogService.log({
    actorId:    userId,
    actorName,
    actorRole:  'client',
    action:     'revision.requested',
    targetType: 'video_job',
    targetId:   jobId,
    targetName: job.reference_id,
    reason,
    metadata:   {
      attemptNumber,
      revisionLimit: job.revision_limit,
      classification: 'minor',
      revisionId: revision.id,
    },
  })

  const limitReached = newCount >= job.revision_limit
  if (limitReached) {
    await autoEscalate(jobId, userId, actorName, 'Revision limit reached')
  }

  return {
    accepted:        true,
    classification:  'minor' as const,
    revision,
    attemptNumber,
    limitReached,
  }
}

// ── Approve preview ────────────────────────────────────────────────────────

export async function approvePreview(params: {
  jobId: string
  userId: string
  actorName: string
}) {
  const { jobId, userId, actorName } = params

  const job = await prisma.videoJob.findUnique({
    where: { id: jobId },
    select: { id: true, reference_id: true, status: true },
  })
  if (!job) throw new Error('Job not found')
  if (job.status !== 'review') throw new Error('Preview can only be approved when in review status')

  await prisma.videoJob.update({
    where: { id: jobId },
    data:  { client_preview_approved_at: new Date() },
  })

  await auditLogService.log({
    actorId:    userId,
    actorName,
    actorRole:  'client',
    action:     'preview.approved',
    targetType: 'video_job',
    targetId:   jobId,
    targetName: job.reference_id,
    metadata:   { approvedAt: new Date().toISOString() },
  })
}

// ── Escalate to support ────────────────────────────────────────────────────

export async function escalateToSupport(params: {
  jobId: string
  userId: string
  actorName: string
  reason?: string
}) {
  const { jobId, userId, actorName, reason } = params

  const job = await prisma.videoJob.findUnique({
    where: { id: jobId },
    select: { id: true, reference_id: true, status: true, is_escalated_to_support: true },
  })
  if (!job) throw new Error('Job not found')
  if (job.is_escalated_to_support) throw new Error('Already escalated to support')
  if (job.status !== 'review') throw new Error('Can only escalate from review status')

  await prisma.videoJob.update({
    where: { id: jobId },
    data:  { is_escalated_to_support: true },
  })

  await auditLogService.log({
    actorId:    userId,
    actorName,
    actorRole:  'client',
    action:     'revision.escalated_to_support',
    targetType: 'video_job',
    targetId:   jobId,
    targetName: job.reference_id,
    reason:     reason ?? 'Client requested support',
    metadata:   { escalatedAt: new Date().toISOString() },
  })
}

// ── Auto-escalate after limit breach ──────────────────────────────────────

async function autoEscalate(
  jobId: string,
  userId: string,
  actorName: string,
  reason: string,
) {
  await prisma.videoJob.update({
    where: { id: jobId },
    data:  { is_escalated_to_support: true },
  })

  const job = await prisma.videoJob.findUnique({
    where: { id: jobId },
    select: { reference_id: true },
  })

  await auditLogService.log({
    actorId:    userId,
    actorName,
    actorRole:  'system',
    action:     'revision.auto_escalated',
    targetType: 'video_job',
    targetId:   jobId,
    targetName: job?.reference_id,
    reason,
    metadata:   { autoEscalated: true, escalatedAt: new Date().toISOString() },
  })
}

// ── List revisions for a job ───────────────────────────────────────────────

export async function listRevisions(jobId: string) {
  return prisma.previewRevision.findMany({
    where:   { video_job_id: jobId },
    orderBy: { created_at: 'asc' },
  })
}

// ── Admin: list all revisions ──────────────────────────────────────────────

export async function adminListRevisions(params: {
  status?: string
  page?: number
  limit?: number
}) {
  const { status, page = 1, limit = 20 } = params
  const where: Record<string, unknown> = {}
  if (status) where.status = status

  const skip = (page - 1) * limit
  const [revisions, total] = await Promise.all([
    prisma.previewRevision.findMany({
      where,
      orderBy: { created_at: 'desc' },
      skip,
      take: limit,
      include: {
        video_job: {
          select: {
            reference_id: true, product_type: true, status: true,
            user:      { select: { name: true, email: true } },
            celebrity: { select: { name: true } },
          },
        },
      },
    }),
    prisma.previewRevision.count({ where }),
  ])

  return { revisions, total, page, pages: Math.ceil(total / limit) }
}
