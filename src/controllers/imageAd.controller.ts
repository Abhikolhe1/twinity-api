import type { Prisma } from '@prisma/client'
import { Response, NextFunction } from 'express'

import prisma from '../lib/prisma'
import { AppError } from '../middleware/errorHandler'
import { AuthRequest } from '../middleware/auth'
import { generateGeminiImage } from '../services/gemini-image.service'
import { settingsService } from '../services/settings.service'
import { validateSubmission } from '../services/submission-validation.service'
import { logger } from '../config/logger'
import { emailService } from '../services/email.service'

function generateRef(): string {
  const year = new Date().getFullYear()
  const seq  = Math.floor(Math.random() * 9000) + 1000
  return `TWN-${year}-${seq}`
}

function buildSceneNotes(payload: {
  prompt: string
  style?: string
  duration?: string
  territory?: string
  exclusivity?: boolean
}): string {
  return [
    payload.prompt.trim(),
    payload.style ? `Visual style: ${payload.style}` : '',
    payload.duration ? `License duration: ${payload.duration}` : '',
    payload.territory ? `Territory: ${payload.territory}` : '',
    payload.exclusivity !== undefined ? `Exclusivity: ${payload.exclusivity}` : '',
  ].filter(Boolean).join('. ')
}

async function markImageAdFailed(jobId: string, referenceId: string, error: unknown) {
  logger.error(`[ImageAd] Gemini generation failed for ${referenceId}:`, error)

  const errorMessage = error instanceof Error ? error.message : 'Gemini image generation failed'
  const current = await prisma.videoJob.findUnique({
    where: { id: jobId },
    select: { status_history: true },
  })
  const history = Array.isArray(current?.status_history) ? current.status_history : []

  await prisma.videoJob.update({
    where: { id: jobId },
    data: {
      status: 'failed',
      error_message: errorMessage,
      status_history: [
        ...history,
        { status: 'failed', timestamp: new Date().toISOString(), note: errorMessage },
      ] as Prisma.InputJsonValue,
    },
  })
}

async function kickOffImageAdGeneration(job: {
  id: string
  reference_id: string
  created_at: Date
  script: string | null
  aspect_ratio: string | null
}) {
  const imagePrompt = [
    'Create a high-end advertising background scene for a brand campaign.',
    'The image must contain NO people, NO faces, and NO human figures.',
    `Campaign brief: ${(job.script || '').trim()}`,
    'Style: premium brand advertising, cinematic product photography, bold atmospheric composition.',
    job.aspect_ratio ? `Aspect ratio: ${job.aspect_ratio}.` : '',
  ].filter(Boolean).join(' ')

  const { s3Bucket } = await settingsService.get()

  generateGeminiImage({ prompt: imagePrompt, referenceId: job.reference_id, s3Bucket })
    .then(async (result) => {
      const current = await prisma.videoJob.findUnique({
        where: { id: job.id },
        select: { status_history: true },
      })
      const history = Array.isArray(current?.status_history) ? current.status_history : []

      await prisma.videoJob.update({
        where: { id: job.id },
        data: {
          status:          'review',
          preview_url:     result.imageUrl,
          watermarked_url: result.imageUrl,
          final_video_url: result.imageUrl,
          status_history: [
            ...history,
            {
              status: 'review',
              timestamp: new Date().toISOString(),
              note: result.status === 'stub'
                ? 'Stub image — ready for CS review'
                : 'Gemini image generated — pending CS review',
            },
          ] as Prisma.InputJsonValue,
        },
      })

      logger.info(`[ImageAd] Job ${job.reference_id} -> review (${result.status})`)
    })
    .catch((error) => markImageAdFailed(job.id, job.reference_id, error))
}

type ImageAdPayload = {
  celebrityId?: string
  prompt?: string
  style?: string
  aspectRatio?: string
  channels?: string[]
  duration?: string
  territory?: string
  exclusivity?: boolean
  estimatedPrice?: number
}

function validatePayload(payload: ImageAdPayload) {
  if (!payload.celebrityId) throw new AppError('celebrityId is required', 400)
  if (!payload.prompt || payload.prompt.trim().length < 10) {
    throw new AppError('prompt must be at least 10 characters', 400)
  }
}

async function getSubmissionUserContext(userId: string | undefined): Promise<{ accountType?: string | null; company?: string | null }> {
  if (!userId) return {}
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { account_type: true, company: true },
  })
  return {
    accountType: user?.account_type,
    company: user?.company,
  }
}

export async function generateImageAd(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const payload = req.body as ImageAdPayload
    validatePayload(payload)

    const submissionValidation = await validateSubmission(
      {
        celebrityId: payload.celebrityId,
        productType: 'image-ad',
        purpose: 'Image ad generation',
        script: payload.prompt,
        channels: payload.channels,
        duration: payload.duration,
        territory: payload.territory,
        exclusivity: payload.exclusivity,
        estimatedPrice: payload.estimatedPrice,
        aspectRatio: payload.aspectRatio,
      },
      await getSubmissionUserContext(req.userId),
    )
    if (!submissionValidation.valid) {
      throw new AppError(submissionValidation.errors[0]?.message || 'Submission validation failed', 422)
    }

    const celeb = await prisma.celebrity.findUnique({ where: { id: payload.celebrityId! } })
    if (!celeb || !celeb.is_active) throw new AppError('Celebrity not found or inactive', 404)
    const user = await prisma.user.findUnique({
      where: { id: req.userId! },
      select: { email: true, name: true },
    })
    if (!user) throw new AppError('User not found', 404)

    const job = await prisma.videoJob.create({
      data: {
        reference_id:    generateRef(),
        user_id:         req.userId!,
        celebrity_id:    payload.celebrityId!,
        product_type:    'image_ad',
        purpose:         submissionValidation.normalized.purpose,
        approval_path:   submissionValidation.approvalPath,
        script:          submissionValidation.normalized.script,
        aspect_ratio:    payload.aspectRatio || '16:9',
        channels:        submissionValidation.normalized.channels,
        scene_notes:     buildSceneNotes({
          prompt: payload.prompt!,
          style: payload.style,
          duration: payload.duration,
          territory: payload.territory,
          exclusivity: payload.exclusivity,
        }),
        submission_context: submissionValidation.submissionContext as Prisma.InputJsonValue,
        validation_result:  submissionValidation.validationSummary as Prisma.InputJsonValue,
        submission_audit:   [submissionValidation.auditEntry] as Prisma.InputJsonValue,
        business_verification_required: submissionValidation.businessVerificationRequired,
        business_verification_passed:   submissionValidation.businessVerificationPassed,
        estimated_price: submissionValidation.pricingSnapshot.subtotal,
        currency:        submissionValidation.pricingSnapshot.currency,
        status:          'in_progress',
        status_history:  [
          {
            status: 'pending',
            timestamp: new Date().toISOString(),
            note: `Submission accepted on ${submissionValidation.approvalPath} route`,
          },
          { status: 'in-progress', timestamp: new Date().toISOString(), note: 'Gemini image generation started' },
        ],
      },
    })

    await kickOffImageAdGeneration(job)
    emailService.sendSubmissionConfirmationEmail({
      userEmail: user.email,
      userName: user.name,
      referenceId: job.reference_id,
      productType: String(job.product_type),
      purpose: job.purpose,
      approvalPath: job.approval_path,
      slaHours: submissionValidation.slaHours,
      estimatedPrice: submissionValidation.pricingSnapshot.subtotal,
      currency: submissionValidation.pricingSnapshot.currency,
    }).catch(() => null)

    res.status(201).json({
      success: true,
      referenceId: job.reference_id,
      message: 'Image ad generation started - check My Requests for status updates',
    })
  } catch (err) {
    next(err)
  }
}

export async function retryImageAd(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const payload = req.body as ImageAdPayload
    validatePayload(payload)

    const submissionValidation = await validateSubmission(
      {
        celebrityId: payload.celebrityId,
        productType: 'image-ad',
        purpose: 'Image ad generation',
        script: payload.prompt,
        channels: payload.channels,
        duration: payload.duration,
        territory: payload.territory,
        exclusivity: payload.exclusivity,
        estimatedPrice: payload.estimatedPrice,
        aspectRatio: payload.aspectRatio,
        resumeReferenceId: req.params.referenceId,
      },
      await getSubmissionUserContext(req.userId),
    )
    if (!submissionValidation.valid) {
      throw new AppError(submissionValidation.errors[0]?.message || 'Submission validation failed', 422)
    }

    const existing = await prisma.videoJob.findFirst({
      where: {
        reference_id: req.params.referenceId,
        user_id: req.userId!,
        product_type: 'image_ad',
      },
    })
    if (!existing) throw new AppError('Image ad request not found', 404)

    const celeb = await prisma.celebrity.findUnique({ where: { id: payload.celebrityId! } })
    if (!celeb || !celeb.is_active) throw new AppError('Celebrity not found or inactive', 404)
    const user = await prisma.user.findUnique({
      where: { id: req.userId! },
      select: { email: true, name: true },
    })
    if (!user) throw new AppError('User not found', 404)

    const previousHistory = Array.isArray(existing.status_history) ? existing.status_history : []
    const restartedHistory = [
      ...previousHistory,
      { status: 'pending', timestamp: new Date().toISOString(), note: 'Resubmitted by customer' },
      { status: 'in-progress', timestamp: new Date().toISOString(), note: 'Image generation restarted' },
    ] as Prisma.InputJsonValue

    const updatedJob = await prisma.videoJob.update({
      where: { id: existing.id },
      data: {
        celebrity_id: payload.celebrityId!,
        purpose: submissionValidation.normalized.purpose,
        approval_path: submissionValidation.approvalPath,
        script: submissionValidation.normalized.script,
        aspect_ratio: payload.aspectRatio || '16:9',
        channels: submissionValidation.normalized.channels,
        scene_notes: buildSceneNotes({
          prompt: payload.prompt!,
          style: payload.style,
          duration: payload.duration,
          territory: payload.territory,
          exclusivity: payload.exclusivity,
        }),
        submission_context: submissionValidation.submissionContext as Prisma.InputJsonValue,
        validation_result:  submissionValidation.validationSummary as Prisma.InputJsonValue,
        submission_audit: [
          ...(Array.isArray(existing.submission_audit) ? existing.submission_audit : []),
          submissionValidation.auditEntry,
        ] as Prisma.InputJsonValue,
        business_verification_required: submissionValidation.businessVerificationRequired,
        business_verification_passed:   submissionValidation.businessVerificationPassed,
        estimated_price: submissionValidation.pricingSnapshot.subtotal,
        currency: submissionValidation.pricingSnapshot.currency,
        status: 'in_progress',
        error_message: null,
        preview_url: null,
        watermarked_url: null,
        final_video_url: null,
        download_enabled: false,
        delivered_at: null,
        status_history: restartedHistory,
      },
    })

    await kickOffImageAdGeneration(updatedJob)
    emailService.sendSubmissionConfirmationEmail({
      userEmail: user.email,
      userName: user.name,
      referenceId: updatedJob.reference_id,
      productType: String(updatedJob.product_type),
      purpose: updatedJob.purpose,
      approvalPath: updatedJob.approval_path,
      slaHours: submissionValidation.slaHours,
      estimatedPrice: submissionValidation.pricingSnapshot.subtotal,
      currency: submissionValidation.pricingSnapshot.currency,
      isResubmission: true,
    }).catch(() => null)

    res.json({
      success: true,
      referenceId: updatedJob.reference_id,
      message: 'Image ad request resubmitted successfully',
    })
  } catch (err) {
    next(err)
  }
}
