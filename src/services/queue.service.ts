/**
 * Queue Service — routes video generation jobs to the correct AI provider.
 *
 * Routing by product_type:
 *   greeting  → Creatify Aurora (celebrity image + voice audio → lip-synced video)
 *   video_ad  → fal.ai Seedance 2.0 (celebrity image + prompt → animated ad video)
 *
 * Stub mode: both providers stub gracefully when credentials are absent.
 */
import { Prisma } from '@prisma/client'
import { logger } from '../config/logger'
import prisma from '../lib/prisma'
import { aiService } from './ai.service'
import { s3Service } from './s3.service'
import { submitSeedanceVideo } from './fal-video.service'
import { applyWatermarkAndAdvanceJob } from './watermark.service'
import { env } from '../config/env'

async function appendHistory(jobId: string, entry: { status: string; timestamp: string; note?: string }): Promise<Prisma.InputJsonValue> {
  const job = await prisma.videoJob.findUnique({ where: { id: jobId }, select: { status_history: true } })
  const history = (Array.isArray(job?.status_history) ? job!.status_history : []) as Prisma.InputJsonValue[]
  return [...history, entry] as Prisma.InputJsonValue
}

// ── Creatify (greeting) ───────────────────────────────────────────────────────

async function processGreetingJob(jobId: string, job: Awaited<ReturnType<typeof loadJob>>): Promise<void> {
  if (!job) return
  const celeb = job.celebrity

  try {
    if (!job.voice_audio_url) throw new Error('No voice audio — complete a voice preview in the wizard before generating')

    const voiceAudioUrl = (await s3Service.presignIfS3Short(job.voice_audio_url, 7200)) ?? job.voice_audio_url
    if (!celeb?.thumbnail_url) throw new Error(`Celebrity ${celeb?.name} has no thumbnail_url — upload a photo in the admin panel`)
    const imageUrl = await s3Service.presignIfS3Short(celeb.thumbnail_url, 7200)

    const callbackUrl = env.serverUrl ? `${env.serverUrl}/api/webhooks/creatify` : undefined
    const backgroundImageUrl = job.background_image_url
      ? (await s3Service.presignIfS3Short(job.background_image_url, 7200)) ?? job.background_image_url
      : undefined

    const render = await aiService.creatifyAurora({
      audioUrl:           voiceAudioUrl,
      imageUrl:           imageUrl!,
      referenceId:        job.reference_id,
      callbackUrl,
      creatifyPrompt:     job.scene_notes || undefined,
      backgroundImageUrl,
    })

    if (render.status === 'stub') {
      const reviewHistory = await appendHistory(jobId, { status: 'review', timestamp: new Date().toISOString(), note: 'Stub render — ready for CS review' })
      await prisma.videoJob.update({
        where: { id: jobId },
        data: {
          creatify_job_id: render.jobId,
          preview_url:     voiceAudioUrl,
          watermarked_url: voiceAudioUrl,
          final_video_url: voiceAudioUrl,
          status:          'review',
          status_history:  reviewHistory,
        },
      })
      logger.info(`[Queue] Job ${job.reference_id} → review (stub)`)
    } else {
      await prisma.videoJob.update({ where: { id: jobId }, data: { creatify_job_id: render.jobId } })
      logger.info(`[Queue] Job ${job.reference_id} Creatify queued → awaiting webhook (id: ${render.jobId})`)
    }
  } catch (err: any) {
    logger.error(`[Queue] Greeting job ${job.reference_id} failed:`, err)
    const failedHistory = await appendHistory(jobId, { status: 'failed', timestamp: new Date().toISOString(), note: err?.message ?? 'AI processing error' })
    await prisma.videoJob.update({ where: { id: jobId }, data: { status: 'failed', error_message: err?.message ?? 'AI processing error', status_history: failedHistory } })
  }
}

// ── fal.ai Seedance (video_ad) ────────────────────────────────────────────────

async function processVideoAdJob(jobId: string, job: Awaited<ReturnType<typeof loadJob>>): Promise<void> {
  if (!job) return
  const celeb = job.celebrity

  try {
    if (!celeb?.thumbnail_url) throw new Error(`Celebrity ${celeb?.name} has no thumbnail_url — upload a photo in the admin panel`)

    const imageUrl = (await s3Service.presignIfS3Short(celeb.thumbnail_url, 7200)) ?? celeb.thumbnail_url
    const callbackUrl = env.serverUrl ? `${env.serverUrl}/api/webhooks/fal` : undefined

    const videoPrompt = [
      job.script || '',
      job.scene_notes || '',
    ].filter(Boolean).join('. ')

    const result = await submitSeedanceVideo({ imageUrl, referenceId: job.reference_id, callbackUrl, videoPrompt })

    if (result.status === 'stub') {
      // Stub mode: advance directly to review with placeholder
      const stubJobAdapter = makeJobAdapter(jobId, job.reference_id, {
        finalVideoUrl:  imageUrl,
        watermarkedUrl: imageUrl,
        previewUrl:     imageUrl,
        status:         'in-progress',
        statusHistory:  (Array.isArray(job.status_history) ? job.status_history : []) as unknown[],
      })
      await applyWatermarkAndAdvanceJob(stubJobAdapter as any, imageUrl)
      logger.info(`[Queue] Video ad ${job.reference_id} → review (stub)`)
    } else {
      await prisma.videoJob.update({ where: { id: jobId }, data: { creatify_job_id: result.requestId } })
      logger.info(`[Queue] Video ad ${job.reference_id} submitted to fal.ai → awaiting webhook (id: ${result.requestId})`)
    }
  } catch (err: any) {
    logger.error(`[Queue] Video ad ${job.reference_id} failed:`, err)
    const failedHistory = await appendHistory(jobId, { status: 'failed', timestamp: new Date().toISOString(), note: err?.message ?? 'fal.ai Seedance error' })
    await prisma.videoJob.update({ where: { id: jobId }, data: { status: 'failed', error_message: err?.message ?? 'fal.ai Seedance error', status_history: failedHistory } })
  }
}

// ── Shared helpers ────────────────────────────────────────────────────────────

async function loadJob(jobId: string) {
  return prisma.videoJob.findUnique({
    where: { id: jobId },
    include: { celebrity: { select: { id: true, name: true, slug: true, voice_model_id: true, thumbnail_url: true } } },
  })
}

function makeJobAdapter(jobId: string, referenceId: string, initialData: Record<string, unknown>) {
  const data: Record<string, unknown> = { ...initialData }
  return {
    id:             jobId,
    referenceId,
    get finalVideoUrl()  { return data.finalVideoUrl  as string },
    set finalVideoUrl(v) { data.finalVideoUrl  = v },
    get watermarkedUrl() { return data.watermarkedUrl as string },
    set watermarkedUrl(v){ data.watermarkedUrl = v },
    get previewUrl()     { return data.previewUrl     as string },
    set previewUrl(v)    { data.previewUrl     = v },
    get status()         { return data.status         as string },
    set status(v)        { data.status         = v },
    get statusHistory()  { return data.statusHistory  as unknown[] },
    save: async () => {
      const current = await prisma.videoJob.findUnique({ where: { id: jobId }, select: { status_history: true } })
      const existing = (Array.isArray(current?.status_history) ? current!.status_history : []) as unknown[]
      const newEntries = (data.statusHistory as unknown[]).slice(existing.length)
      const merged = [...existing, ...newEntries]
      const updatePayload: Record<string, unknown> = { status_history: merged }
      if (data.finalVideoUrl  !== undefined) updatePayload.final_video_url  = data.finalVideoUrl
      if (data.watermarkedUrl !== undefined) updatePayload.watermarked_url  = data.watermarkedUrl
      if (data.previewUrl     !== undefined) updatePayload.preview_url      = data.previewUrl
      if (data.status         !== undefined) {
        const s = data.status as string
        updatePayload.status = s === 'in-progress' ? 'in_progress' : s
      }
      await prisma.videoJob.update({ where: { id: jobId }, data: updatePayload })
    },
  }
}

async function processJob(jobId: string): Promise<void> {
  logger.info(`[Queue] processJob: ${jobId}`)

  const job = await loadJob(jobId)

  if (!job) { logger.warn(`[Queue] job ${jobId} not found — skipping`); return }
  if (job.status !== 'pending') { logger.warn(`[Queue] job ${job.reference_id} status=${job.status} — skipping`); return }

  const inProgressHistory = await appendHistory(jobId, { status: 'in-progress', timestamp: new Date().toISOString(), note: 'AI processing started' })
  await prisma.videoJob.update({ where: { id: jobId }, data: { status: 'in_progress', status_history: inProgressHistory } })
  logger.info(`[Queue] Job ${job.reference_id} (${job.product_type}) → in-progress`)

  if ((job.product_type as string) === 'video_ad') {
    await processVideoAdJob(jobId, job)
  } else {
    // greeting (and any unrecognised type) → Creatify Aurora
    await processGreetingJob(jobId, job)
  }
}

export const queueService = {
  async dispatchVideoJob(jobId: string): Promise<void> {
    logger.info(`[Queue] Dispatching: ${jobId}`)
    await processJob(jobId)
  },

  async dispatchNotification(type: string, payload: Record<string, unknown>): Promise<void> {
    logger.info(`[Queue] Notification: ${type}`, payload)
  },
}
