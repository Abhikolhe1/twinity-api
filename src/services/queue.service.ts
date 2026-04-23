/**
 * Queue Service — processes video generation jobs.
 *
 * Pipeline:
 *   1. Generate voice audio via ElevenLabs TTS (using celebrity's voiceModelId)
 *   2. Submit Seedance 2.0 job via fal.ai (celebrity image + audio → video, async queue)
 *      — completion delivered via:
 *        a) fal.ai webhook → falWebhook()      (when SERVER_URL is set)
 *        b) Status poll fallback — pollInProgressJobs() checks every 30s
 *   3. On completion: download fal.ai temp video → upload to S3 → store permanent URL
 *
 * Stub mode (no fal.ai key): job advances directly to review with audio preview URL.
 */
import { logger } from '../config/logger'
import { VideoJob, IVideoJob } from '../models/VideoJob'
import { ProductType } from '../models/ProductType'
import { aiService } from './ai.service'
import { s3Service } from './s3.service'
import { settingsService } from './settings.service'
import { env } from '../config/env'

const POLL_INTERVAL_MS  = 30_000
const FAL_QUEUE_BASE    = 'https://queue.fal.run'
const SEEDANCE_ENDPOINT = 'bytedance/seedance-2.0/fast/reference-to-video'
const SYNCLABS_ENDPOINT = 'fal-ai/sync-lipsync'

interface FalStatusResponse {
  status?: string
  request_id?: string
  error?: string
}

interface FalResultResponse {
  video?: { url?: string; content_type?: string; file_name?: string; file_size?: number }
  seed?: number
}

/**
 * Downloads the fal.ai temporary video URL and uploads it to S3.
 * Returns the permanent S3 URL, or the original URL if upload fails.
 */
async function archiveVideoToS3(
  falVideoUrl: string,
  referenceId: string,
  s3Bucket: string,
): Promise<string> {
  try {
    logger.info(`[Queue] Downloading fal.ai video for ${referenceId}: ${falVideoUrl}`)
    const res = await fetch(falVideoUrl)
    if (!res.ok) throw new Error(`Download failed (${res.status})`)

    const buffer = Buffer.from(await res.arrayBuffer())
    const key    = `jobs/${referenceId}/final-video.mp4`
    const upload = await s3Service.upload(s3Bucket, key, buffer, 'video/mp4')

    if (upload.stub) {
      logger.info(`[Queue] S3 stub — keeping fal.ai URL for ${referenceId}`)
      return falVideoUrl
    }

    const permanentUrl = await s3Service.getPresignedUrl(s3Bucket, upload.key, 60 * 60 * 24 * 7)
    logger.info(`[Queue] Video archived to S3 for ${referenceId}: ${permanentUrl}`)
    return permanentUrl
  } catch (err) {
    logger.warn(`[Queue] S3 archive failed for ${referenceId} (using fal URL as fallback): ${String(err)}`)
    return falVideoUrl
  }
}

async function pollSeedanceJobs(jobs: IVideoJob[], falApiKey: string): Promise<void> {
  for (const job of jobs) {
    if (!job.seedanceRequestId) continue
    try {
      const statusRes = await fetch(
        `${FAL_QUEUE_BASE}/${SEEDANCE_ENDPOINT}/requests/${job.seedanceRequestId}/status`,
        { headers: { 'Authorization': `Key ${falApiKey}` } },
      )
      if (!statusRes.ok) {
        logger.warn(`[Queue] Seedance status poll ${statusRes.status} for job ${job.referenceId}`)
        continue
      }
      const statusData = await statusRes.json() as FalStatusResponse
      logger.info(`[Queue] Seedance poll ${job.referenceId}: status=${statusData.status}`)

      if (statusData.status === 'COMPLETED') {
        const resultRes = await fetch(
          `${FAL_QUEUE_BASE}/${SEEDANCE_ENDPOINT}/requests/${job.seedanceRequestId}`,
          { headers: { 'Authorization': `Key ${falApiKey}` } },
        )
        if (!resultRes.ok) {
          logger.warn(`[Queue] Seedance result fetch failed (${resultRes.status}) for ${job.referenceId}`)
          continue
        }
        const result = await resultRes.json() as FalResultResponse
        const falUrl = result.video?.url ?? ''
        if (!falUrl) {
          logger.warn(`[Queue] Seedance poll: no video.url for ${job.referenceId}`)
          continue
        }

        const { s3Bucket } = await settingsService.get()
        const videoUrl = await archiveVideoToS3(falUrl, job.referenceId, s3Bucket)

        job.finalVideoUrl  = videoUrl
        job.watermarkedUrl = videoUrl
        job.previewUrl     = videoUrl
        job.status         = 'review'
        job.statusHistory.push({ status: 'review', timestamp: new Date(), note: 'Seedance 2.0 complete (poll)' })
        await job.save()
        logger.info(`[Queue] Job ${job.referenceId} → review via Seedance poll`)

      } else if (statusData.status === 'FAILED') {
        job.status = 'failed'
        job.errorMessage = statusData.error ?? 'Seedance 2.0 render failed'
        job.statusHistory.push({ status: 'failed', timestamp: new Date(), note: job.errorMessage })
        await job.save()
        logger.warn(`[Queue] Job ${job.referenceId} → failed via Seedance poll`)
      }
    } catch (err) {
      logger.warn(`[Queue] Seedance poll error for job ${job.referenceId}:`, err)
    }
  }
}

async function pollSyncLabsJobs(jobs: IVideoJob[], falApiKey: string): Promise<void> {
  for (const job of jobs) {
    if (!job.syncLabsRequestId) continue
    try {
      const statusRes = await fetch(
        `${FAL_QUEUE_BASE}/${SYNCLABS_ENDPOINT}/requests/${job.syncLabsRequestId}/status`,
        { headers: { 'Authorization': `Key ${falApiKey}` } },
      )
      if (!statusRes.ok) {
        logger.warn(`[Queue] SyncLabs status poll ${statusRes.status} for job ${job.referenceId}`)
        continue
      }
      const statusData = await statusRes.json() as FalStatusResponse
      logger.info(`[Queue] SyncLabs poll ${job.referenceId}: status=${statusData.status}`)

      if (statusData.status === 'COMPLETED') {
        const resultRes = await fetch(
          `${FAL_QUEUE_BASE}/${SYNCLABS_ENDPOINT}/requests/${job.syncLabsRequestId}`,
          { headers: { 'Authorization': `Key ${falApiKey}` } },
        )
        if (!resultRes.ok) {
          logger.warn(`[Queue] SyncLabs result fetch failed (${resultRes.status}) for ${job.referenceId}`)
          continue
        }
        const result = await resultRes.json() as FalResultResponse
        const falUrl = result.video?.url ?? ''
        if (!falUrl) {
          logger.warn(`[Queue] SyncLabs poll: no video.url for ${job.referenceId}`)
          continue
        }

        const { s3Bucket } = await settingsService.get()
        const videoUrl = await archiveVideoToS3(falUrl, job.referenceId, s3Bucket)

        job.finalVideoUrl  = videoUrl
        job.watermarkedUrl = videoUrl
        job.previewUrl     = videoUrl
        job.status         = 'review'
        job.statusHistory.push({ status: 'review', timestamp: new Date(), note: 'SyncLabs lipsync complete (poll)' })
        await job.save()
        logger.info(`[Queue] Job ${job.referenceId} → review via SyncLabs poll`)

      } else if (statusData.status === 'FAILED') {
        job.status = 'failed'
        job.errorMessage = statusData.error ?? 'SyncLabs lipsync failed'
        job.statusHistory.push({ status: 'failed', timestamp: new Date(), note: job.errorMessage })
        await job.save()
        logger.warn(`[Queue] Job ${job.referenceId} → failed via SyncLabs poll`)
      }
    } catch (err) {
      logger.warn(`[Queue] SyncLabs poll error for job ${job.referenceId}:`, err)
    }
  }
}

async function pollInProgressJobs(): Promise<void> {
  try {
    const jobs = await VideoJob.find({ status: 'in-progress' })
    if (jobs.length === 0) return

    logger.info(`[Queue] Polling ${jobs.length} in-progress job(s)`)
    const settings = await settingsService.get()

    if (settings.falApiKey) {
      // Step 1: Seedance jobs waiting for base video (no syncLabsRequestId yet)
      const seedanceJobs = jobs.filter(j => j.seedanceRequestId && !j.syncLabsRequestId && !j.finalVideoUrl)
      if (seedanceJobs.length > 0) await pollSeedanceJobs(seedanceJobs, settings.falApiKey)

      // Step 2: SyncLabs jobs waiting for lip-synced final video
      const syncLabsJobs = jobs.filter(j => j.syncLabsRequestId && !j.finalVideoUrl)
      if (syncLabsJobs.length > 0) await pollSyncLabsJobs(syncLabsJobs, settings.falApiKey)
    }
  } catch (err) {
    logger.error('[Queue] pollInProgressJobs error:', err)
  }
}

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
    // ── Step 1: Use pre-generated preview audio ──────────────────────────
    // Voice audio is always generated during the wizard preview step.
    // The Generate button is disabled until a take is selected, so voiceAudioUrl
    // is guaranteed to be set on every job that reaches this point.
    if (!job.voiceAudioUrl) throw new Error('No voice audio — complete a voice preview in the wizard before generating')

    // Re-presign the stored S3 URL to reset the 2-hour expiry window
    const voiceAudioUrl = (await s3Service.presignIfS3Short(job.voiceAudioUrl, 7200)) ?? job.voiceAudioUrl
    logger.info(`[Queue] Job ${job.referenceId} — using preview audio: ${voiceAudioUrl}`)

    // ── Step 2: Seedance 2.0 (image + audio → video) ────────────────────
    if (!celeb.thumbnailUrl) throw new Error(`Celebrity ${celeb.name} has no thumbnailUrl — upload a photo in the admin panel`)

    const imageUrl = await s3Service.presignIfS3Short(celeb.thumbnailUrl, 7200)
    logger.info(`[Queue] Job ${job.referenceId} — imageUrl=${imageUrl}`)

    const callbackUrl = env.serverUrl ? `${env.serverUrl}/api/webhooks/fal` : undefined

    const productTypDoc = await ProductType.findOne({ slug: job.productType }).lean()

    // Presign background image (2h) so fal.ai can download it
    const backgroundImageUrl = job.backgroundImageUrl
      ? (await s3Service.presignIfS3Short(job.backgroundImageUrl, 7200)) ?? job.backgroundImageUrl
      : undefined

    const videoPrompt = [productTypDoc?.videoPrompt, job.sceneNotes]
      .filter(Boolean)
      .join('. ')

    const render = await aiService.seedanceVideo({
      imageUrl:           imageUrl!,
      backgroundImageUrl,
      referenceId:        job.referenceId,
      callbackUrl,
      videoPrompt:        videoPrompt || undefined,
      audioDuration:      job.audioDuration,
    })

    job.seedanceRequestId = render.requestId

    if (render.status === 'stub') {
      // Stub / no fal.ai key — advance directly to review with audio preview
      job.previewUrl     = voiceAudioUrl
      job.watermarkedUrl = voiceAudioUrl
      job.finalVideoUrl  = voiceAudioUrl
      job.status = 'review'
      job.statusHistory.push({ status: 'review', timestamp: new Date(), note: 'Stub render — ready for CS review' })
      logger.info(`[Queue] Job ${job.referenceId} → review (stub), audio preview: ${voiceAudioUrl}`)
    } else {
      logger.info(`[Queue] Job ${job.referenceId} Seedance queued → awaiting webhook (request_id: ${render.requestId})`)
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

  startPoller(): void {
    logger.info(`[Queue] Starting Seedance status poller (interval: ${POLL_INTERVAL_MS / 1000}s)`)
    setInterval(pollInProgressJobs, POLL_INTERVAL_MS)
    pollInProgressJobs().catch(() => null)
  },
}
