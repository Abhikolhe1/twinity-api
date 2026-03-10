/**
 * Queue Service — processes video generation jobs.
 * Submits to Higgsfield and returns immediately.
 * Job completion is handled by the Higgsfield webhook (webhook.controller.ts).
 *
 * Full pipeline (production):
 *   1. Generate voice audio via ElevenLabs (if voiceModelId set)
 *      OR fall back to celebrity's stored training audio (trainingAudioUrl)
 *   2. Submit video render to Higgsfield (async — webhook fires on completion)
 *   3. Webhook handler triggers SyncLabs lip sync once video is ready
 */
import { logger } from '../config/logger'
import { VideoJob } from '../models/VideoJob'
import { Celebrity } from '../models/Celebrity'
import { aiService } from './ai.service'
import { settingsService } from './settings.service'
import { env } from '../config/env'

async function processJob(jobId: string): Promise<void> {
  const job = await VideoJob.findById(jobId).populate<{
    celebrityId: {
      name: string
      slug: string
      voiceModelId?: string
      avatarModelId?: string
      trainingAudioUrl?: string
    }
  }>('celebrityId', 'name slug voiceModelId avatarModelId trainingAudioUrl')

  if (!job || job.status !== 'pending') return

  const celeb = job.celebrityId as {
    name: string
    slug: string
    voiceModelId?: string
    avatarModelId?: string
    trainingAudioUrl?: string
  }

  // ── Step 1: in-progress ──────────────────────────────────────────────
  job.status = 'in-progress'
  job.statusHistory.push({ status: 'in-progress', timestamp: new Date(), note: 'AI processing started' })
  await job.save()
  logger.info(`[Queue] Job ${job.referenceId} → in-progress`)

  try {
    const settings = await settingsService.get()

    // ── Step 2: Voice audio — ElevenLabs TTS or training audio ──────────
    let voiceAudioUrl: string | null = null

    if (celeb.voiceModelId && settings.elevenLabsKey) {
      try {
        const voice = await aiService.generateVoice(celeb.voiceModelId, job.script, celeb.slug)
        job.voiceJobId   = voice.jobId
        job.voiceAudioUrl = voice.audioUrl
        voiceAudioUrl    = voice.audioUrl
        logger.info(`[Queue] Job ${job.referenceId} — ElevenLabs voice generated: ${voice.audioUrl}`)
      } catch (voiceErr: any) {
        logger.warn(`[Queue] Job ${job.referenceId} — ElevenLabs voice failed, falling back: ${voiceErr?.message}`)
      }
    }

    // Fall back to celebrity's stored training audio if ElevenLabs unavailable
    if (!voiceAudioUrl && celeb.trainingAudioUrl) {
      job.voiceAudioUrl = celeb.trainingAudioUrl
      voiceAudioUrl     = celeb.trainingAudioUrl
      logger.info(`[Queue] Job ${job.referenceId} — using celebrity training audio: ${voiceAudioUrl}`)
    }

    // ── Step 3: Submit render to Higgsfield (webhook handles completion) ──
    const characterId = celeb.avatarModelId || `stub-char-${job.celebrityId}`
    // Build the public webhook URL Higgsfield will call back on completion
    const webhookUrl = `${env.cors.clientUrl.replace(':3000', ':4000')}/api/webhooks/higgsfield`
    const render = await aiService.renderVideo({
      characterId,
      script: job.script,
      duration: job.duration,
      aspectRatio: job.aspectRatio,
      watermarkText: settings.watermarkText,
      webhookUrl,
    })

    job.aiJobId = render.requestId

    if (render.status === 'stub') {
      // Dev mode: no real Higgsfield — advance directly to review with stub URLs
      job.watermarkedUrl = 'https://stub-watermarked.mp4'
      job.previewUrl     = 'https://stub-watermarked.mp4'
      job.finalVideoUrl  = 'https://stub-video.mp4'
      job.status = 'review'
      job.statusHistory.push({ status: 'review', timestamp: new Date(), note: 'Stub render — ready for CS review' })
      logger.info(`[Queue] Job ${job.referenceId} → review (stub)`)
    } else {
      // Production: job stays in-progress until Higgsfield webhook fires
      // The webhook will pick up voiceAudioUrl from the job and submit to SyncLabs
      logger.info(`[Queue] Job ${job.referenceId} render submitted → awaiting Higgsfield webhook (requestId: ${render.requestId})`)
    }

    await job.save()

  } catch (err: any) {
    logger.error(`[Queue] Job ${job.referenceId} failed:`, err)
    job.status = 'failed'
    job.errorMessage = err?.message ?? 'AI processing error'
    job.statusHistory.push({ status: 'failed', timestamp: new Date(), note: job.errorMessage })
    await job.save()
  }
}

export const queueService = {
  async dispatchVideoJob(jobId: string): Promise<void> {
    logger.info(`[Queue] Dispatching video job: ${jobId}`)
    setTimeout(() => processJob(jobId).catch(err => logger.error('[Queue] processJob error:', err)), 3_000)
  },

  async dispatchNotification(type: string, payload: Record<string, unknown>): Promise<void> {
    logger.info(`[Queue] Notification dispatch: ${type}`, payload)
  },
}
