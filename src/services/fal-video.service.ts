/**
 * FAL Video Service — Seedance 2.0 video generation via fal.ai queue API.
 *
 * Endpoint: bytedance/seedance-2.0/fast/reference-to-video
 * Auth:     Authorization: Key {falApiKey}
 *
 * Async flow:
 *   submit()     → POST queue.fal.run/...  → returns request_id
 *   getStatus()  → GET  .../requests/{id}/status
 *   getResult()  → GET  .../requests/{id}
 *
 * Completion signalled via:
 *   a) fal.ai webhook → POST {SERVER_URL}/api/webhooks/fal  (when callbackUrl provided)
 *   b) startPoller()  → polls every 30s for jobs without a webhook delivery
 *
 * Job tracking uses the existing creatify_job_id column to store the fal request_id.
 */
import { Prisma } from '@prisma/client'
import { logger } from '../config/logger'
import prisma from '../lib/prisma'
import { settingsService } from './settings.service'
import { s3Service } from './s3.service'
import { applyWatermarkAndAdvanceJob } from './watermark.service'

const FAL_QUEUE_BASE    = 'https://queue.fal.run'
const SEEDANCE_ENDPOINT = 'bytedance/seedance-2.0/fast/reference-to-video'
const POLL_INTERVAL_MS  = 30_000

export interface SeedanceSubmitResult {
  requestId: string
  status:    'submitted' | 'stub'
}

interface FalStatusResponse {
  status?: string
  error?:  string
}

interface FalResultResponse {
  video?: { url?: string }
}

/* ── Submit ──────────────────────────────────────────────────────────────────── */

export async function submitSeedanceVideo(params: {
  audioUrl?:   string
  imageUrl:    string
  referenceId: string
  callbackUrl?: string
  videoPrompt?: string
}): Promise<SeedanceSubmitResult> {
  const { falApiKey } = await settingsService.get()

  if (!falApiKey) {
    logger.warn('[FalVideo] fal.ai key not set — returning stub')
    return { requestId: `stub-seedance-${Date.now()}`, status: 'stub' }
  }

  if (!params.imageUrl) throw new Error('Seedance: imageUrl is empty — upload a celebrity photo in the admin panel')

  const prompt = params.videoPrompt?.trim() || 'Natural, realistic celebrity video. Professional tone. Clean motion.'

  logger.info(`[FalVideo] Seedance 2.0 submitting: referenceId=${params.referenceId}, prompt="${prompt}"`)

  const body: Record<string, unknown> = {
    prompt,
    image_urls: [params.imageUrl],
    resolution: '720p',
    duration:   'auto',
  }
  if (params.audioUrl) {
    body.audio_urls     = [params.audioUrl]
    body.generate_audio = false
  } else {
    body.generate_audio = false
  }

  // Pass webhook as a query parameter — keeps it separate from model inputs
  const submitUrl = params.callbackUrl
    ? `${FAL_QUEUE_BASE}/${SEEDANCE_ENDPOINT}?fal_webhook=${encodeURIComponent(params.callbackUrl)}`
    : `${FAL_QUEUE_BASE}/${SEEDANCE_ENDPOINT}`

  const res = await fetch(submitUrl, {
    method: 'POST',
    headers: { 'Authorization': `Key ${falApiKey}`, 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  })

  const text = await res.text()
  if (!res.ok) throw new Error(`Seedance submit failed (${res.status}): ${text}`)

  const data = JSON.parse(text) as { request_id?: string }
  if (!data.request_id) throw new Error(`Seedance: no request_id in response: ${text}`)

  logger.info(`[FalVideo] Seedance 2.0 job submitted: request_id=${data.request_id}`)
  return { requestId: data.request_id, status: 'submitted' }
}

/* ── Archive ─────────────────────────────────────────────────────────────────── */

async function archiveVideoFromFal(falUrl: string, referenceId: string, s3Bucket: string): Promise<string> {
  try {
    const res = await fetch(falUrl)
    if (!res.ok) throw new Error(`Download failed (${res.status})`)
    const buffer  = Buffer.from(await res.arrayBuffer())
    const upload  = await s3Service.upload(s3Bucket, `jobs/${referenceId}/final-video.mp4`, buffer, 'video/mp4')
    if (upload.stub) return falUrl
    logger.info(`[FalVideo] Archived to S3 for ${referenceId}: ${upload.url}`)
    return upload.url
  } catch (err) {
    logger.warn(`[FalVideo] S3 archive failed for ${referenceId} — using fal URL: ${String(err)}`)
    return falUrl
  }
}

/* ── Poller ──────────────────────────────────────────────────────────────────── */

function makeJobAdapter(jobId: string, referenceId: string, initialData: Record<string, unknown>) {
  const data: Record<string, unknown> = { ...initialData }
  return {
    id:          jobId,
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
    push: (entry: unknown) => { (data.statusHistory as unknown[]).push(entry) },
    save: async () => {
      const current = await prisma.videoJob.findUnique({ where: { id: jobId }, select: { status_history: true } })
      const existing = (Array.isArray(current?.status_history) ? current!.status_history : []) as unknown[]
      const newEntries = (data.statusHistory as unknown[]).slice(existing.length)
      const merged = [...existing, ...newEntries]

      const payload: Record<string, unknown> = { status_history: merged }
      if (data.finalVideoUrl  !== undefined) payload.final_video_url  = data.finalVideoUrl
      if (data.watermarkedUrl !== undefined) payload.watermarked_url  = data.watermarkedUrl
      if (data.previewUrl     !== undefined) payload.preview_url      = data.previewUrl
      if (data.status         !== undefined) {
        const s = data.status as string
        payload.status = s === 'in-progress' ? 'in_progress' : s
      }
      await prisma.videoJob.update({ where: { id: jobId }, data: payload })
    },
  }
}

async function pollOnce(): Promise<void> {
  const jobs = await prisma.videoJob.findMany({
    where: { status: 'in_progress', product_type: 'image_ad', creatify_job_id: { not: null }, final_video_url: null },
    select: { id: true, reference_id: true, creatify_job_id: true, user_id: true, watermarked_url: true, preview_url: true, status: true, status_history: true },
  })
  if (jobs.length === 0) return

  logger.info(`[FalVideo] Polling ${jobs.length} in-progress Seedance job(s)`)
  const { falApiKey, s3Bucket } = await settingsService.get()
  if (!falApiKey) return

  for (const job of jobs) {
    const requestId = job.creatify_job_id!
    try {
      const statusRes = await fetch(
        `${FAL_QUEUE_BASE}/${SEEDANCE_ENDPOINT}/requests/${requestId}/status`,
        { headers: { 'Authorization': `Key ${falApiKey}` } },
      )
      if (!statusRes.ok) {
        logger.warn(`[FalVideo] Status poll ${statusRes.status} for job ${job.reference_id}`)
        continue
      }
      const statusData = await statusRes.json() as FalStatusResponse
      logger.info(`[FalVideo] Poll ${job.reference_id}: status=${statusData.status}`)

      if (statusData.status === 'COMPLETED') {
        const resultRes = await fetch(
          `${FAL_QUEUE_BASE}/${SEEDANCE_ENDPOINT}/requests/${requestId}`,
          { headers: { 'Authorization': `Key ${falApiKey}` } },
        )
        if (!resultRes.ok) {
          logger.warn(`[FalVideo] Result fetch failed (${resultRes.status}) for ${job.reference_id}`)
          continue
        }
        const result = await resultRes.json() as FalResultResponse
        const falUrl = result.video?.url ?? ''
        if (!falUrl) {
          logger.warn(`[FalVideo] No video.url in result for ${job.reference_id}`)
          continue
        }

        const videoUrl = await archiveVideoFromFal(falUrl, job.reference_id, s3Bucket)

        const jobAdapter = makeJobAdapter(job.id, job.reference_id, {
          finalVideoUrl:  '',
          watermarkedUrl: job.watermarked_url ?? '',
          previewUrl:     job.preview_url     ?? '',
          status:         job.status,
          statusHistory:  (Array.isArray(job.status_history) ? job.status_history : []) as unknown[],
        })

        applyWatermarkAndAdvanceJob(jobAdapter as any, videoUrl)
          .then(() => logger.info(`[FalVideo] Job ${job.reference_id} → review (poll)`))
          .catch(err => logger.error(`[FalVideo] applyWatermark failed for ${job.reference_id}:`, err))

      } else if (statusData.status === 'FAILED') {
        const errorMsg = statusData.error ?? 'Seedance 2.0 render failed'
        const current  = await prisma.videoJob.findUnique({ where: { id: job.id }, select: { status_history: true } })
        const history  = (Array.isArray(current?.status_history) ? current!.status_history : []) as Prisma.InputJsonValue[]
        const newHistory: Prisma.InputJsonValue = [...history, { status: 'failed', timestamp: new Date().toISOString(), note: errorMsg }]
        await prisma.videoJob.update({
          where: { id: job.id },
          data:  { status: 'failed', error_message: errorMsg, status_history: newHistory },
        })
        logger.warn(`[FalVideo] Job ${job.reference_id} → failed (poll)`)
      }
    } catch (err) {
      logger.warn(`[FalVideo] Poll error for job ${job.reference_id}:`, err)
    }
  }
}

/* ── Public API ──────────────────────────────────────────────────────────────── */

export const falVideoService = {
  submit: submitSeedanceVideo,

  startPoller(): void {
    logger.info(`[FalVideo] Starting Seedance poller (interval: ${POLL_INTERVAL_MS / 1000}s)`)
    setInterval(() => pollOnce().catch(() => null), POLL_INTERVAL_MS)
    pollOnce().catch(() => null)
  },
}
