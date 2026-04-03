/**
 * Queue Service — processes video generation jobs.
 *
 * Pipeline:
 *   1. Generate voice audio via ElevenLabs TTS (using celebrity's voiceModelId)
 *   2. Submit Higgsfield lipsync job (celebrity image + audio → lip-synced video)
 *      — async; completion delivered via Higgsfield webhook → higgsfieldWebhook()
 *
 *
 * Stub mode (no Higgsfield key): job advances directly to review with audio preview URL.
 */
import { logger } from '../config/logger'
import { VideoJob } from '../models/VideoJob'
import { Celebrity } from '../models/Celebrity'
import { aiService } from './ai.service'
import { s3Service } from './s3.service'
import { settingsService } from './settings.service'
import { env } from '../config/env'

async function processJob(jobId: string): Promise<void> {
  logger.info(`[Queue] processJob started: jobId=${jobId}`)
  const job = await VideoJob.findById(jobId).populate<{
    celebrityId: {
      _id: string
      name: string
      slug: string
      voiceModelId?: string
      thumbnailUrl?: string
    }
  }>('celebrityId', 'name slug voiceModelId thumbnailUrl')

  if (!job) {
    logger.warn(`[Queue] processJob: job ${jobId} not found in DB — skipping`)
    return
  }
  if (job.status !== 'pending') {
    logger.warn(`[Queue] processJob: job ${job.referenceId} status=${job.status} — skipping (not pending)`)
    return
  }

  const celeb = job.celebrityId as {
    _id: string
    name: string
    slug: string
    voiceModelId?: string
    thumbnailUrl?: string
  }

  // ── Step 1: in-progress ──────────────────────────────────────────────
  job.status = 'in-progress'
  job.statusHistory.push({ status: 'in-progress', timestamp: new Date(), note: 'AI processing started' })
  await job.save()
  logger.info(`[Queue] Job ${job.referenceId} → in-progress`)

  try {
    const settings = await settingsService.get()

    // ── Step 2: ElevenLabs TTS — generate voice audio ───────────────────
    if (!celeb.voiceModelId) throw new Error(`Celebrity ${celeb.name} has no ElevenLabs voiceModelId`)
    if (!settings.elevenLabsKey) throw new Error('ElevenLabs API key not configured')

    const voice = await aiService.generateVoice(celeb.voiceModelId, job.script, celeb.slug)
    job.voiceJobId    = voice.jobId
    job.voiceAudioUrl = voice.audioUrl
    const voiceAudioUrl = voice.audioUrl
    logger.info(`[Queue] Job ${job.referenceId} — ElevenLabs voice generated: ${voice.audioUrl}`)

    // ── Step 3: Higgsfield lipsync (image + audio → lip-synced video) ──
    if (!celeb.thumbnailUrl) throw new Error(`Celebrity ${celeb.name} has no thumbnailUrl — upload a photo in the admin panel`)
    const imageUrl = await s3Service.presignIfS3(celeb.thumbnailUrl, 7200)
    logger.info(`[Queue] Job ${job.referenceId} — imageUrl=${imageUrl}`)

    const callbackUrl = env.serverUrl ? `${env.serverUrl}/api/webhooks/higgsfield` : undefined

    // Build an enriched prompt: script + scene context
    const sceneParts: string[] = [job.script]
    if (job.sceneNotes) sceneParts.push(`Scene: ${job.sceneNotes}`)
    const prompt = sceneParts.join('. ')

    const render = await aiService.higgsfieldVideoGenerate({
      audioUrl:    voiceAudioUrl,
      imageUrl:    imageUrl!,
      aspectRatio: job.aspectRatio,
      referenceId: job.referenceId,
      script:      prompt,
      callbackUrl,
    })

    job.aiJobId = render.jobId

    if (render.status === 'stub') {
      // Stub / no Higgsfield key — advance directly to review with audio preview
      job.previewUrl     = voiceAudioUrl
      job.watermarkedUrl = voiceAudioUrl
      job.finalVideoUrl  = voiceAudioUrl
      job.status = 'review'
      job.statusHistory.push({ status: 'review', timestamp: new Date(), note: 'Stub render — ready for CS review' })
      logger.info(`[Queue] Job ${job.referenceId} → review (stub), audio preview: ${voiceAudioUrl}`)
    } else {
      // 'submitted' — video generation queued, waiting for Higgsfield webhook
      logger.info(`[Queue] Job ${job.referenceId} Higgsfield lipsync queued → awaiting webhook (job_id: ${render.jobId})`)
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
    await processJob(jobId)
  },

  async dispatchNotification(type: string, payload: Record<string, unknown>): Promise<void> {
    logger.info(`[Queue] Notification dispatch: ${type}`, payload)
  },
}
