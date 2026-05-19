/**
 * Queue Service — submits video generation jobs to Creatify Aurora.
 *
 * Pipeline:
 *   1. Use pre-generated voice audio (recorded during wizard preview step)
 *   2. Submit Creatify Aurora job (celebrity image + audio → lip-synced video, async)
 *      — completion delivered via Creatify webhook → /api/webhooks/creatify
 *
 * Stub mode (no Creatify keys): job advances directly to review with audio preview URL.
 */
import { Prisma } from '@prisma/client'
import { logger } from '../config/logger'
import prisma from '../lib/prisma'
import { aiService } from './ai.service'
import { s3Service } from './s3.service'
import { env } from '../config/env'

// Helper: fetch statusHistory array, append entry, return updated array
async function appendHistory(jobId: string, entry: { status: string; timestamp: string; note?: string }): Promise<Prisma.InputJsonValue> {
  const job = await prisma.videoJob.findUnique({ where: { id: jobId }, select: { statusHistory: true } })
  const history = (Array.isArray(job?.statusHistory) ? job!.statusHistory : []) as Prisma.InputJsonValue[]
  return [...history, entry] as Prisma.InputJsonValue
}

async function processJob(jobId: string): Promise<void> {
  logger.info(`[Queue] processJob started: jobId=${jobId}`)

  const job = await prisma.videoJob.findUnique({
    where: { id: jobId },
    include: {
      celebrity: { select: { id: true, name: true, slug: true, voiceModelId: true, thumbnailUrl: true } },
    },
  })

  if (!job) {
    logger.warn(`[Queue] processJob: job ${jobId} not found in DB — skipping`)
    return
  }
  if (job.status !== 'pending') {
    logger.warn(`[Queue] processJob: job ${job.referenceId} status=${job.status} — skipping (not pending)`)
    return
  }

  const celeb = job.celebrity

  const inProgressHistory = await appendHistory(jobId, { status: 'in-progress', timestamp: new Date().toISOString(), note: 'AI processing started' })
  await prisma.videoJob.update({
    where: { id: jobId },
    data: { status: 'in_progress', statusHistory: inProgressHistory },
  })
  logger.info(`[Queue] Job ${job.referenceId} → in-progress`)

  try {
    if (!job.voiceAudioUrl) throw new Error('No voice audio — complete a voice preview in the wizard before generating')

    const voiceAudioUrl = (await s3Service.presignIfS3Short(job.voiceAudioUrl, 7200)) ?? job.voiceAudioUrl
    logger.info(`[Queue] Job ${job.referenceId} — using preview audio: ${voiceAudioUrl}`)

    if (!celeb?.thumbnailUrl) throw new Error(`Celebrity ${celeb?.name} has no thumbnailUrl — upload a photo in the admin panel`)

    const imageUrl = await s3Service.presignIfS3Short(celeb.thumbnailUrl, 7200)
    logger.info(`[Queue] Job ${job.referenceId} — imageUrl=${imageUrl}`)

    const callbackUrl = env.serverUrl ? `${env.serverUrl}/api/webhooks/creatify` : undefined

    const backgroundImageUrl = job.backgroundImageUrl
      ? (await s3Service.presignIfS3Short(job.backgroundImageUrl, 7200)) ?? job.backgroundImageUrl
      : undefined

    const render = await aiService.creatifyAurora({
      audioUrl:           voiceAudioUrl,
      imageUrl:           imageUrl!,
      referenceId:        job.referenceId,
      callbackUrl,
      creatifyPrompt:     job.sceneNotes || undefined,
      backgroundImageUrl,
    })

    if (render.status === 'stub') {
      const reviewHistory = await appendHistory(jobId, { status: 'review', timestamp: new Date().toISOString(), note: 'Stub render — ready for CS review' })
      await prisma.videoJob.update({
        where: { id: jobId },
        data: {
          creatifyJobId:  render.jobId,
          previewUrl:     voiceAudioUrl,
          watermarkedUrl: voiceAudioUrl,
          finalVideoUrl:  voiceAudioUrl,
          status:         'review',
          statusHistory:  reviewHistory,
        },
      })
      logger.info(`[Queue] Job ${job.referenceId} → review (stub), audio preview: ${voiceAudioUrl}`)
    } else {
      await prisma.videoJob.update({
        where: { id: jobId },
        data: { creatifyJobId: render.jobId },
      })
      logger.info(`[Queue] Job ${job.referenceId} Creatify Aurora queued → awaiting webhook (id: ${render.jobId})`)
    }

  } catch (err: any) {
    logger.error(`[Queue] Job ${job.referenceId} failed:`, err)
    const failedHistory = await appendHistory(jobId, { status: 'failed', timestamp: new Date().toISOString(), note: err?.message ?? 'AI processing error' })
    await prisma.videoJob.update({
      where: { id: jobId },
      data: {
        status:       'failed',
        errorMessage: err?.message ?? 'AI processing error',
        statusHistory: failedHistory,
      },
    })
  }
}

export const queueService = {
  async dispatchVideoJob(jobId: string): Promise<void> {
    logger.info(`[Queue] Dispatching video job: ${jobId}`)
    await processJob(jobId)
  },

  async dispatchNotification(type: string, payload: Record<string, unknown>): Promise<void> {
    logger.info(`[Queue] Notification dispatch: ${type}`, payload)
  },
}
