/**
 * Queue Service — processes video generation jobs.
 *
 * Pipeline:
 *   1. Generate voice audio via ElevenLabs TTS (using celebrity's voiceModelId)
 *   2. Submit Creatify Aurora job (celebrity image + audio → lip-synced video)
 *      — async; completion delivered via:
 *        a) Creatify webhook → creatifyWebhook()   (when SERVER_URL is set)
 *        b) Status poll fallback — pollInProgressJobs() checks every 30s
 *
 * Stub mode (no Creatify keys): job advances directly to review with audio preview URL.
 */
import { logger } from '../config/logger'
import { VideoJob, IVideoJob } from '../models/VideoJob'
import { Celebrity } from '../models/Celebrity'
import { aiService } from './ai.service'
import { s3Service } from './s3.service'
import { settingsService } from './settings.service'
import { env } from '../config/env'

const POLL_INTERVAL_MS = 30_000  // poll every 30 seconds

interface CreatifyStatusResponse {
  id?: string
  status?: string
  video_output?: string
  failed_reason?: string
}

async function pollCreatifyJobs(
  jobs: IVideoJob[],
  apiId: string,
  apiKey: string,
): Promise<void> {
  for (const job of jobs) {
    if (!job.creatifyJobId) continue
    try {
      const res = await fetch(`https://api.creatify.ai/api/aurora/${job.creatifyJobId}/`, {
        headers: {
          'X-API-ID':  apiId,
          'X-API-KEY': apiKey,
        },
      })
      if (!res.ok) {
        logger.warn(`[Queue] Creatify poll ${res.status} for job ${job.referenceId}`)
        continue
      }
      const data = await res.json() as CreatifyStatusResponse
      logger.info(`[Queue] Creatify poll ${job.referenceId}: status=${data.status}`)

      if (data.status === 'done') {
        const videoUrl = data.video_output ?? ''
        if (!videoUrl) {
          logger.warn(`[Queue] Creatify poll: no video_output for ${job.referenceId}`)
          continue
        }
        job.finalVideoUrl  = videoUrl
        job.watermarkedUrl = videoUrl
        job.previewUrl     = videoUrl
        job.status         = 'review'
        job.statusHistory.push({ status: 'review', timestamp: new Date(), note: 'Creatify Aurora complete (poll)' })
        await job.save()
        logger.info(`[Queue] Job ${job.referenceId} → review via Creatify poll, url=${videoUrl}`)
      } else if (data.status === 'failed') {
        job.status = 'failed'
        job.errorMessage = data.failed_reason ?? 'Creatify Aurora render failed'
        job.statusHistory.push({ status: 'failed', timestamp: new Date(), note: job.errorMessage })
        await job.save()
        logger.warn(`[Queue] Job ${job.referenceId} → failed via Creatify poll`)
      }
    } catch (err) {
      logger.warn(`[Queue] Creatify poll error for job ${job.referenceId}:`, err)
    }
  }
}

async function pollInProgressJobs(): Promise<void> {
  try {
    const jobs = await VideoJob.find({ status: 'in-progress' })
    if (jobs.length === 0) return

    logger.info(`[Queue] Polling ${jobs.length} in-progress job(s)`)
    const settings = await settingsService.get()

    // Jobs waiting for Creatify (have creatifyJobId, no finalVideoUrl yet)
    const creatifyJobs = jobs.filter(j => j.creatifyJobId && !j.finalVideoUrl)
    if (creatifyJobs.length > 0 && settings.creatifyApiId && settings.creatifyApiKey) {
      await pollCreatifyJobs(creatifyJobs, settings.creatifyApiId, settings.creatifyApiKey)
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
    const settings = await settingsService.get()

    // ── Step 2: ElevenLabs TTS — generate voice audio ───────────────────
    if (!celeb.voiceModelId) throw new Error(`Celebrity ${celeb.name} has no ElevenLabs voiceModelId`)
    if (!settings.elevenLabsKey) throw new Error('ElevenLabs API key not configured')

    // Limit script to 25 words to keep audio concise for Creatify Aurora
    const MAX_WORDS = 25
    const scriptWords = job.script.trim().split(/\s+/)
    const ttsScript = scriptWords.length > MAX_WORDS
      ? scriptWords.slice(0, MAX_WORDS).join(' ')
      : job.script
    if (scriptWords.length > MAX_WORDS) {
      logger.warn(`[Queue] Job ${job.referenceId} — script truncated from ${scriptWords.length} to ${MAX_WORDS} words`)
    }

    const voice = await aiService.generateVoice(celeb.voiceModelId, ttsScript, celeb.slug)
    job.voiceJobId    = voice.jobId
    job.voiceAudioUrl = voice.audioUrl
    const voiceAudioUrl = voice.audioUrl
    logger.info(`[Queue] Job ${job.referenceId} — ElevenLabs voice generated: ${voiceAudioUrl} (${voice.durationSecs}s)`)

    // ── Step 3: Creatify Aurora (image + audio → lip-synced video) ──────
    if (!celeb.thumbnailUrl) throw new Error(`Celebrity ${celeb.name} has no thumbnailUrl — upload a photo in the admin panel`)
    const imageUrl = await s3Service.presignIfS3(celeb.thumbnailUrl, 7200)
    logger.info(`[Queue] Job ${job.referenceId} — imageUrl=${imageUrl}`)

    const callbackUrl = env.serverUrl ? `${env.serverUrl}/api/webhooks/creatify` : undefined

    const render = await aiService.creatifyAurora({
      audioUrl:    voiceAudioUrl,
      imageUrl:    imageUrl!,
      referenceId: job.referenceId,
      callbackUrl,
    })

    job.creatifyJobId = render.jobId

    if (render.status === 'stub') {
      // Stub / no Creatify keys — advance directly to review with audio preview
      job.previewUrl     = voiceAudioUrl
      job.watermarkedUrl = voiceAudioUrl
      job.finalVideoUrl  = voiceAudioUrl
      job.status = 'review'
      job.statusHistory.push({ status: 'review', timestamp: new Date(), note: 'Stub render — ready for CS review' })
      logger.info(`[Queue] Job ${job.referenceId} → review (stub), audio preview: ${voiceAudioUrl}`)
    } else {
      // 'submitted' — video generation queued, waiting for Creatify webhook
      logger.info(`[Queue] Job ${job.referenceId} Creatify Aurora queued → awaiting webhook (id: ${render.jobId})`)
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
    logger.info(`[Queue] Starting Creatify status poller (interval: ${POLL_INTERVAL_MS / 1000}s)`)
    setInterval(pollInProgressJobs, POLL_INTERVAL_MS)
    // Run once immediately on startup to catch any jobs left in-progress from a previous run
    pollInProgressJobs().catch(() => null)
  },
}
