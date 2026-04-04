/**
 * Queue Service — processes video generation jobs.
 *
 * Pipeline:
 *   1. Generate voice audio via ElevenLabs TTS (using celebrity's voiceModelId)
 *   2. Submit Higgsfield lipsync job (celebrity image + audio → lip-synced video)
 *      — async; completion delivered via:
 *        a) Higgsfield webhook → higgsfieldWebhook()   (when SERVER_URL is set)
 *        b) Status poll fallback — pollInProgressJobs() checks every 30s
 *
 * Stub mode (no Higgsfield key): job advances directly to review with audio preview URL.
 */
import { logger } from '../config/logger'
import { VideoJob, IVideoJob } from '../models/VideoJob'
import { Celebrity } from '../models/Celebrity'
import { aiService } from './ai.service'
import { s3Service } from './s3.service'
import { settingsService } from './settings.service'
import { env } from '../config/env'

const POLL_INTERVAL_MS = 30_000  // poll every 30 seconds

interface HiggsfieldStatusResponse {
  status?: string
  request_id?: string
  video?: { url?: string }
  error?: string
}

interface SyncLabsStatusResponse {
  id?: string
  status?: string
  outputUrl?: string
  error?: string
  error_code?: string
}

async function pollHiggsfieldJobs(
  jobs: IVideoJob[],
  keyId: string,
  keySecret: string,
): Promise<void> {
  for (const job of jobs) {
    if (!job.higgsfieldStatusUrl) continue
    try {
      const res = await fetch(job.higgsfieldStatusUrl, {
        headers: { 'Authorization': `Key ${keyId}:${keySecret}` },
      })
      if (!res.ok) {
        logger.warn(`[Queue] Higgsfield poll ${res.status} for job ${job.referenceId}`)
        continue
      }
      const data = await res.json() as HiggsfieldStatusResponse
      logger.info(`[Queue] Higgsfield poll ${job.referenceId}: status=${data.status}`)

      if (data.status === 'completed') {
        const videoUrl = data.video?.url ?? ''
        if (!videoUrl) { logger.warn(`[Queue] Higgsfield poll: no video URL for ${job.referenceId}`); continue }

        job.rawVideoUrl = videoUrl
        const { syncLabsKey } = await settingsService.get()

        if (syncLabsKey && job.voiceAudioUrl) {
          const callbackUrl = env.serverUrl ? `${env.serverUrl}/api/webhooks/synclabs` : undefined
          const lipSync = await aiService.syncLabsLipSync({
            videoUrl, audioUrl: job.voiceAudioUrl, referenceId: job.referenceId, callbackUrl,
          })
          job.syncLabsJobId = lipSync.jobId
          logger.info(`[Queue] Sync.so queued via poll: id=${lipSync.jobId}, job=${job.referenceId}`)
        } else {
          job.finalVideoUrl  = videoUrl
          job.watermarkedUrl = videoUrl
          job.previewUrl     = videoUrl
          job.status         = 'review'
          job.statusHistory.push({ status: 'review', timestamp: new Date(), note: 'Higgsfield video complete (poll)' })
          logger.info(`[Queue] Job ${job.referenceId} → review via Higgsfield poll`)
        }
        await job.save()
      } else if (data.status === 'failed' || data.status === 'error') {
        job.status = 'failed'
        job.errorMessage = data.error ?? 'Higgsfield render failed'
        job.statusHistory.push({ status: 'failed', timestamp: new Date(), note: job.errorMessage })
        await job.save()
        logger.warn(`[Queue] Job ${job.referenceId} → failed via Higgsfield poll`)
      }
    } catch (err) {
      logger.warn(`[Queue] Higgsfield poll error for job ${job.referenceId}:`, err)
    }
  }
}

async function pollSyncLabsJobs(
  jobs: IVideoJob[],
  syncLabsKey: string,
): Promise<void> {
  for (const job of jobs) {
    if (!job.syncLabsJobId) continue
    try {
      const res = await fetch(`https://api.sync.so/v2/generate/${job.syncLabsJobId}`, {
        headers: { 'x-api-key': syncLabsKey },
      })
      if (!res.ok) {
        logger.warn(`[Queue] Sync.so poll ${res.status} for job ${job.referenceId}`)
        continue
      }
      const data = await res.json() as SyncLabsStatusResponse
      logger.info(`[Queue] Sync.so poll ${job.referenceId}: status=${data.status}`)

      if (data.status === 'COMPLETED') {
        const videoUrl = data.outputUrl ?? ''
        if (!videoUrl) { logger.warn(`[Queue] Sync.so poll: no outputUrl for ${job.referenceId}`); continue }
        job.finalVideoUrl  = videoUrl
        job.watermarkedUrl = videoUrl
        job.previewUrl     = videoUrl
        job.status         = 'review'
        job.statusHistory.push({ status: 'review', timestamp: new Date(), note: 'Sync.so lip-sync complete (poll)' })
        await job.save()
        logger.info(`[Queue] Job ${job.referenceId} → review via Sync.so poll, url=${videoUrl}`)
      } else if (data.status === 'FAILED' || data.status === 'REJECTED') {
        job.status = 'failed'
        job.errorMessage = data.error ?? data.error_code ?? 'Sync.so lip-sync failed'
        job.statusHistory.push({ status: 'failed', timestamp: new Date(), note: job.errorMessage })
        await job.save()
        logger.warn(`[Queue] Job ${job.referenceId} → failed via Sync.so poll`)
      }
    } catch (err) {
      logger.warn(`[Queue] Sync.so poll error for job ${job.referenceId}:`, err)
    }
  }
}

async function pollInProgressJobs(): Promise<void> {
  try {
    const jobs = await VideoJob.find({ status: 'in-progress' })
    if (jobs.length === 0) return

    logger.info(`[Queue] Polling ${jobs.length} in-progress job(s)`)
    const settings = await settingsService.get()

    // Jobs waiting for Higgsfield (have status URL, no rawVideoUrl yet)
    const higgsfieldJobs = jobs.filter(j => j.higgsfieldStatusUrl && !j.rawVideoUrl)
    if (higgsfieldJobs.length > 0 && settings.higgsfieldKeyId && settings.higgsfieldKeySecret) {
      await pollHiggsfieldJobs(higgsfieldJobs, settings.higgsfieldKeyId, settings.higgsfieldKeySecret)
    }

    // Jobs waiting for Sync.so (have syncLabsJobId, no finalVideoUrl yet)
    const syncLabsJobs = jobs.filter(j => j.syncLabsJobId && !j.finalVideoUrl)
    if (syncLabsJobs.length > 0 && settings.syncLabsKey) {
      await pollSyncLabsJobs(syncLabsJobs, settings.syncLabsKey)
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

    // Higgsfield max video duration is 10s — limit script to ~25 words (~10s at normal pace)
    const MAX_WORDS = 25
    const scriptWords = job.script.trim().split(/\s+/)
    const ttsScript = scriptWords.length > MAX_WORDS
      ? scriptWords.slice(0, MAX_WORDS).join(' ')
      : job.script
    if (scriptWords.length > MAX_WORDS) {
      logger.warn(`[Queue] Job ${job.referenceId} — script truncated from ${scriptWords.length} to ${MAX_WORDS} words for Higgsfield duration limit`)
    }

    const voice = await aiService.generateVoice(celeb.voiceModelId, ttsScript, celeb.slug)
    job.voiceJobId    = voice.jobId
    job.voiceAudioUrl = voice.audioUrl
    const voiceAudioUrl = voice.audioUrl
    const audioDuration = Math.min(voice.durationSecs, 10)  // hard cap at Higgsfield max
    logger.info(`[Queue] Job ${job.referenceId} — ElevenLabs voice generated: ${voice.audioUrl} (${audioDuration}s)`)

    // ── Step 3: Higgsfield lipsync (image + audio → lip-synced video) ──
    if (!celeb.thumbnailUrl) throw new Error(`Celebrity ${celeb.name} has no thumbnailUrl — upload a photo in the admin panel`)
    const imageUrl = await s3Service.presignIfS3(celeb.thumbnailUrl, 7200)
    logger.info(`[Queue] Job ${job.referenceId} — imageUrl=${imageUrl}`)

    const callbackUrl = env.serverUrl ? `${env.serverUrl}/api/webhooks/higgsfield` : undefined

    // Build an enriched prompt: script + all available scene context
    const sceneParts: string[] = [job.script]
    if (job.sceneNotes) sceneParts.push(`Scene description: ${job.sceneNotes}`)
    // Include background image URL only when it's a real HTTP URL (not base64)
    if (job.backgroundImageUrl && job.backgroundImageUrl.startsWith('http')) {
      sceneParts.push(`Background reference: ${job.backgroundImageUrl}`)
    }
    const prompt = sceneParts.join('. ')
    logger.info(`[Queue] Job ${job.referenceId} — Higgsfield prompt: ${prompt.slice(0, 200)}`)
    logger.info(`[Queue] Job ${job.referenceId} — audio_url: ${voiceAudioUrl}`)

    const render = await aiService.higgsfieldVideoGenerate({
      audioUrl:     voiceAudioUrl,
      imageUrl:     imageUrl!,
      aspectRatio:  job.aspectRatio,
      referenceId:  job.referenceId,
      script:       prompt,
      durationSecs: audioDuration,
      callbackUrl,
    })

    job.aiJobId = render.jobId
    if (render.statusUrl) job.higgsfieldStatusUrl = render.statusUrl

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

  startPoller(): void {
    logger.info(`[Queue] Starting Higgsfield status poller (interval: ${POLL_INTERVAL_MS / 1000}s)`)
    setInterval(pollInProgressJobs, POLL_INTERVAL_MS)
    // Run once immediately on startup to catch any jobs left in-progress from a previous run
    pollInProgressJobs().catch(() => null)
  },
}
