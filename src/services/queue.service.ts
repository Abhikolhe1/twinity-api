/**
 * Queue Service — processes video generation jobs.
 *
 * Pipeline:
 *   1. Generate voice audio via ElevenLabs TTS (using celebrity's voiceModelId)
 *   2. Submit HeyGen Talking Photo job (celebrity image + audio → lip-synced video)
 *      — async; webhook fires on completion (webhook.controller.ts → heygenWebhook)
 *   3. Cache the HeyGen talking_photo_id on the Celebrity document to avoid
 *      re-uploading the image for future jobs.
 *
 * Stub mode (no HeyGen key): job advances directly to review with audio preview URL.
 */
import { logger } from '../config/logger'
import { VideoJob } from '../models/VideoJob'
import { Celebrity } from '../models/Celebrity'
import { aiService } from './ai.service'
import { s3Service } from './s3.service'
import { settingsService } from './settings.service'

async function processJob(jobId: string): Promise<void> {
  logger.info(`[Queue] processJob started: jobId=${jobId}`)
  const job = await VideoJob.findById(jobId).populate<{
    celebrityId: {
      _id: string
      name: string
      slug: string
      voiceModelId?: string
      thumbnailUrl?: string
      heygenPhotoId?: string
    }
  }>('celebrityId', 'name slug voiceModelId thumbnailUrl heygenPhotoId')

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
    heygenPhotoId?: string
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

    // ── Step 3: HeyGen Talking Photo (image + audio → lip-synced video) ─
    if (!celeb.thumbnailUrl) throw new Error(`Celebrity ${celeb.name} has no thumbnailUrl — upload a photo in the admin panel`)
    const imageUrl = await s3Service.presignIfS3(celeb.thumbnailUrl, 7200)
    logger.info(`[Queue] Job ${job.referenceId} — imageUrl=${imageUrl}`)

    const render = await aiService.heygenLipSync({
      audioUrl:      voiceAudioUrl,
      imageUrl:      imageUrl!,
      heygenPhotoId: celeb.heygenPhotoId,
      aspectRatio:   job.aspectRatio,
      referenceId:   job.referenceId,
    })

    job.aiJobId = render.requestId

    if (render.status === 'stub') {
      // Stub / no HeyGen key — advance directly to review with audio preview
      job.previewUrl     = voiceAudioUrl
      job.watermarkedUrl = voiceAudioUrl
      job.finalVideoUrl  = voiceAudioUrl
      job.status = 'review'
      job.statusHistory.push({ status: 'review', timestamp: new Date(), note: 'Stub render — ready for CS review' })
      logger.info(`[Queue] Job ${job.referenceId} → review (stub), audio preview: ${voiceAudioUrl}`)
    } else if (render.status === 'training') {
      // Avatar group is being trained — store group_id in aiJobId so webhook can find this job
      job.aiJobId = render.requestId
      if (render.photoId && render.photoId !== celeb.heygenPhotoId) {
        try {
          await Celebrity.findByIdAndUpdate(celeb._id, { heygenPhotoId: render.photoId })
          logger.info(`[Queue] Cached HeyGen photoId for celebrity ${celeb.name}: ${render.photoId}`)
        } catch (cacheErr: any) {
          logger.warn(`[Queue] Failed to cache HeyGen photoId: ${cacheErr?.message}`)
        }
      }
      logger.info(`[Queue] Job ${job.referenceId} → awaiting HeyGen avatar training webhook (group_id: ${render.requestId})`)
    } else {
      // 'submitted' — video generation queued, waiting for video webhook
      if (render.photoId && render.photoId !== celeb.heygenPhotoId) {
        try {
          await Celebrity.findByIdAndUpdate(celeb._id, { heygenPhotoId: render.photoId })
          logger.info(`[Queue] Updated HeyGen photoId for celebrity ${celeb.name}: ${render.photoId}`)
        } catch (cacheErr: any) {
          logger.warn(`[Queue] Failed to update HeyGen photoId: ${cacheErr?.message}`)
        }
      }
      logger.info(`[Queue] Job ${job.referenceId} HeyGen video queued → awaiting webhook (video_id: ${render.requestId})`)
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

  /**
   * Called by the webhook handler when HeyGen avatar training completes.
   * Submits the video generation job using the trained group_id.
   */
  async triggerVideoGeneration(jobId: string): Promise<void> {
    logger.info(`[Queue] triggerVideoGeneration: jobId=${jobId}`)

    const job = await VideoJob.findById(jobId)
    if (!job) { logger.warn(`[Queue] triggerVideoGeneration: job ${jobId} not found`); return }
    if (!job.voiceAudioUrl) { logger.warn(`[Queue] triggerVideoGeneration: job ${job.referenceId} has no voiceAudioUrl`); return }

    const groupId = job.aiJobId
    if (!groupId) { logger.warn(`[Queue] triggerVideoGeneration: job ${job.referenceId} has no aiJobId (group_id)`); return }

    const celeb = await Celebrity.findById(job.celebrityId)

    try {
      const { s3Service } = await import('./s3.service')
      const audioUrl = await s3Service.presignIfS3(job.voiceAudioUrl, 7200) ?? job.voiceAudioUrl

      const result = await aiService.submitHeyGenVideo({
        audioUrl,
        photoId:     groupId,
        aspectRatio: job.aspectRatio,
        referenceId: job.referenceId,
      })

      if (result.stale) {
        throw new Error(`HeyGen: avatar group ${groupId} still has missing image dimensions after training`)
      }

      job.aiJobId = result.videoId
      await job.save()
      logger.info(`[Queue] Job ${job.referenceId} video generation queued: video_id=${result.videoId}`)

      // Update celebrity heygenPhotoId if it changed
      if (celeb && groupId !== celeb.heygenPhotoId) {
        await Celebrity.findByIdAndUpdate(celeb._id, { heygenPhotoId: groupId })
      }
    } catch (err: any) {
      logger.error(`[Queue] triggerVideoGeneration failed for job ${job.referenceId}:`, err)
      job.status = 'failed'
      job.errorMessage = err?.message ?? 'Video generation failed after avatar training'
      job.statusHistory.push({ status: 'failed', timestamp: new Date(), note: job.errorMessage })
      await job.save()
    }
  },

  async dispatchNotification(type: string, payload: Record<string, unknown>): Promise<void> {
    logger.info(`[Queue] Notification dispatch: ${type}`, payload)
  },
}
