import type { Prisma, RefundRequest, RefundStatus } from '@prisma/client'

import prisma from '../lib/prisma'
import { AppError } from '../middleware/errorHandler'
import { auditLogService } from './auditLog.service'

type RefundRequestWithRelations = RefundRequest & {
  video_job: {
    id: string
    reference_id: string
    status: string
    estimated_price: number
    currency: string
    purpose: string
    product_type: string
    created_at: Date
    error_message: string | null
    user: { id: string; name: string; email: string }
    celebrity: { id: string; name: string }
  }
  user: { id: string; name: string; email: string }
  decision_admin?: { id: string; name: string; email: string } | null
}

async function appendCancelledHistory(jobId: string, note: string): Promise<Prisma.InputJsonValue> {
  const job = await prisma.videoJob.findUnique({
    where: { id: jobId },
    select: { status_history: true },
  })
  const history = Array.isArray(job?.status_history) ? job.status_history : []
  return [
    ...history,
    {
      status: 'cancelled',
      timestamp: new Date().toISOString(),
      note,
    },
  ] as Prisma.InputJsonValue
}

async function getRefundById(id: string): Promise<RefundRequestWithRelations> {
  const refund = await prisma.refundRequest.findUnique({
    where: { id },
    include: {
      user: { select: { id: true, name: true, email: true } },
      decision_admin: { select: { id: true, name: true, email: true } },
      video_job: {
        select: {
          id: true,
          reference_id: true,
          status: true,
          estimated_price: true,
          currency: true,
          purpose: true,
          product_type: true,
          created_at: true,
          error_message: true,
          user: { select: { id: true, name: true, email: true } },
          celebrity: { select: { id: true, name: true } },
        },
      },
    },
  })
  if (!refund) throw new AppError('Refund request not found', 404)
  return refund
}

export const refundService = {
  async requestRefund(userId: string, referenceId: string, reason: string) {
    const cleanReason = String(reason || '').trim()
    if (!cleanReason) throw new AppError('Refund reason is required', 400)

    const job = await prisma.videoJob.findFirst({
      where: {
        reference_id: referenceId,
        user_id: userId,
      },
      include: {
        user: { select: { id: true, name: true, email: true } },
        celebrity: { select: { id: true, name: true } },
        refund_requests: {
          where: { status: { in: ['requested', 'approved', 'partial', 'processed'] } },
          orderBy: { created_at: 'desc' },
          take: 1,
        },
      },
    })

    if (!job) throw new AppError('Request not found', 404)
    if (job.status !== 'failed') {
      throw new AppError('Refund can only be requested for failed requests', 400)
    }
    if (job.refund_requests.length > 0) {
      throw new AppError('A refund request already exists for this request', 400)
    }

    const refund = await prisma.refundRequest.create({
      data: {
        video_job_id: job.id,
        user_id: userId,
        status: 'requested',
        reason: cleanReason,
        requested_amount: job.estimated_price,
        currency: job.currency,
      },
    })

    await auditLogService.log({
      actorId: job.user.id,
      actorName: job.user.name,
      actorRole: 'customer',
      action: 'refund.requested',
      targetType: 'refund_request',
      targetId: refund.id,
      targetName: job.reference_id,
      reason: cleanReason,
      metadata: {
        videoJobId: job.id,
        referenceId: job.reference_id,
        productType: job.product_type,
        requestedAmount: job.estimated_price,
        currency: job.currency,
      },
    })

    return this.getRefund(refund.id)
  },

  async listRefunds(filters: { status?: RefundStatus | 'all'; search?: string }) {
    const where: Prisma.RefundRequestWhereInput = {}

    if (filters.status && filters.status !== 'all') {
      where.status = filters.status
    }

    const search = String(filters.search || '').trim()
    if (search) {
      where.OR = [
        { reason: { contains: search, mode: 'insensitive' } },
        { video_job: { reference_id: { contains: search, mode: 'insensitive' } } },
        { user: { name: { contains: search, mode: 'insensitive' } } },
        { user: { email: { contains: search, mode: 'insensitive' } } },
        { video_job: { celebrity: { name: { contains: search, mode: 'insensitive' } } } },
      ]
    }

    const refunds = await prisma.refundRequest.findMany({
      where,
      include: {
        user: { select: { id: true, name: true, email: true } },
        decision_admin: { select: { id: true, name: true, email: true } },
        video_job: {
          select: {
            id: true,
            reference_id: true,
            status: true,
            estimated_price: true,
            currency: true,
            purpose: true,
            product_type: true,
            created_at: true,
            error_message: true,
            user: { select: { id: true, name: true, email: true } },
            celebrity: { select: { id: true, name: true } },
          },
        },
      },
      orderBy: { requested_at: 'desc' },
    })

    return refunds
  },

  async getRefund(id: string) {
    return getRefundById(id)
  },

  async approveRefund(input: {
    refundId: string
    adminId: string
    adminName: string
    approvedAmount?: number
    note?: string
  }) {
    const refund = await getRefundById(input.refundId)
    if (refund.status !== 'requested') {
      throw new AppError('Only requested refunds can be approved', 400)
    }

    const requestedAmount = refund.requested_amount ?? refund.video_job.estimated_price
    const approvedAmount = input.approvedAmount ?? requestedAmount
    if (approvedAmount <= 0) throw new AppError('Approved amount must be greater than 0', 400)
    if (approvedAmount > requestedAmount) {
      throw new AppError('Approved amount cannot exceed requested amount', 400)
    }

    const nextStatus: RefundStatus = approvedAmount < requestedAmount ? 'partial' : 'approved'

    const updated = await prisma.refundRequest.update({
      where: { id: refund.id },
      data: {
        status: nextStatus,
        approved_amount: approvedAmount,
        admin_note: input.note?.trim() || null,
        decision_by_admin_id: input.adminId,
        decision_at: new Date(),
      },
    })

    await auditLogService.log({
      actorId: input.adminId,
      actorName: input.adminName,
      actorRole: 'admin',
      action: nextStatus === 'partial' ? 'refund.partial_approved' : 'refund.approved',
      targetType: 'refund_request',
      targetId: refund.id,
      targetName: refund.video_job.reference_id,
      reason: input.note?.trim() || undefined,
      metadata: {
        referenceId: refund.video_job.reference_id,
        requestedAmount,
        approvedAmount,
        currency: refund.currency,
      },
    })

    return this.getRefund(updated.id)
  },

  async rejectRefund(input: {
    refundId: string
    adminId: string
    adminName: string
    note: string
  }) {
    const reason = String(input.note || '').trim()
    if (!reason) throw new AppError('Rejection note is required', 400)

    const refund = await getRefundById(input.refundId)
    if (refund.status !== 'requested') {
      throw new AppError('Only requested refunds can be rejected', 400)
    }

    const updated = await prisma.refundRequest.update({
      where: { id: refund.id },
      data: {
        status: 'rejected',
        admin_note: reason,
        decision_by_admin_id: input.adminId,
        decision_at: new Date(),
      },
    })

    await auditLogService.log({
      actorId: input.adminId,
      actorName: input.adminName,
      actorRole: 'admin',
      action: 'refund.rejected',
      targetType: 'refund_request',
      targetId: refund.id,
      targetName: refund.video_job.reference_id,
      reason,
      metadata: {
        referenceId: refund.video_job.reference_id,
        requestedAmount: refund.requested_amount,
        currency: refund.currency,
      },
    })

    return this.getRefund(updated.id)
  },

  async processRefund(input: {
    refundId: string
    adminId: string
    adminName: string
    paymentGateway?: string
    paymentReference?: string
    note?: string
  }) {
    const refund = await getRefundById(input.refundId)
    if (refund.status !== 'approved' && refund.status !== 'partial') {
      throw new AppError('Only approved refunds can be marked as processed', 400)
    }

    const updated = await prisma.refundRequest.update({
      where: { id: refund.id },
      data: {
        status: 'processed',
        processed_at: new Date(),
        admin_note: input.note?.trim() || refund.admin_note || null,
        decision_by_admin_id: input.adminId,
        payment_gateway: input.paymentGateway?.trim() || null,
        payment_reference: input.paymentReference?.trim() || null,
        gateway_payload: {
          ...(refund.gateway_payload && typeof refund.gateway_payload === 'object' ? refund.gateway_payload as Record<string, unknown> : {}),
          processedBy: input.adminName,
          processedAt: new Date().toISOString(),
        },
      },
    })

    const cancelledHistory = await appendCancelledHistory(
      refund.video_job.id,
      'Request closed after refund processing',
    )

    await prisma.videoJob.update({
      where: { id: refund.video_job.id },
      data: {
        status: 'cancelled',
        status_history: cancelledHistory,
      },
    })

    await auditLogService.log({
      actorId: input.adminId,
      actorName: input.adminName,
      actorRole: 'admin',
      action: 'refund.processed',
      targetType: 'refund_request',
      targetId: refund.id,
      targetName: refund.video_job.reference_id,
      reason: input.note?.trim() || undefined,
      metadata: {
        referenceId: refund.video_job.reference_id,
        paymentGateway: input.paymentGateway?.trim() || null,
        paymentReference: input.paymentReference?.trim() || null,
        approvedAmount: refund.approved_amount,
        currency: refund.currency,
      },
    })

    return this.getRefund(updated.id)
  },
}
