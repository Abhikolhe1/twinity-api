/**
 * Webhook Controller — handles inbound callbacks from Higgsfield.
 *
 * Higgsfield → /api/webhooks/higgsfield
 *   - generation.completed — update job URLs, advance status to 'review'
 *   - generation.failed    — mark job failed, notify customer
 *
 * Register the URL in the Higgsfield dashboard.
 */
import { Request, Response } from 'express'
import crypto from 'crypto'
import { VideoJob } from '../models/VideoJob'
import { User } from '../models/User'
import { settingsService } from '../services/settings.service'
import { emailService } from '../services/email.service'
import { aiService } from '../services/ai.service'
import { env } from '../config/env'
import { logger } from '../config/logger'

/**
 * Verify Sync.so webhook signature.
 * Header format: "Sync-Signature: t=<timestamp>,s=<hmac_sha256>"
 * Signed payload: "<timestamp>.<rawBody>"
 * Returns true when secret is not configured (allows testing without secret).
 */
function verifySyncLabsSignature(req: Request & { rawBody?: Buffer }, secret: string): boolean {
  if (!secret) return true  // no secret configured — skip verification

  const header = req.headers['sync-signature'] as string | undefined
  if (!header) {
    logger.warn('[Webhook] Sync.so: missing Sync-Signature header')
    return false
  }

  const parts = Object.fromEntries(header.split(',').map(p => p.split('=')))
  const timestamp = parts['t']
  const signature = parts['s']
  if (!timestamp || !signature) {
    logger.warn('[Webhook] Sync.so: malformed Sync-Signature header')
    return false
  }

  const rawBody = req.rawBody?.toString('utf8') ?? ''
  const signed   = `${timestamp}.${rawBody}`
  const expected = crypto.createHmac('sha256', secret).update(signed).digest('hex')

  const valid = crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(signature, 'hex'))
  if (!valid) logger.warn('[Webhook] Sync.so: signature mismatch')
  return valid
}

// ── Higgsfield webhook — video generation events ──────────────────────────────

/** Fetch the Higgsfield status URL to retrieve the video URL when the webhook body omits it. */
async function fetchHiggsfieldVideoUrl(statusUrl: string): Promise<string> {
  const { higgsfieldKeyId, higgsfieldKeySecret } = await settingsService.get()
  const res = await fetch(statusUrl, {
    headers: { 'Authorization': `Key ${higgsfieldKeyId}:${higgsfieldKeySecret}` },
  })
  if (!res.ok) throw new Error(`Higgsfield status fetch failed (${res.status})`)
  const data = await res.json() as Record<string, unknown>
  const url = (data.video as any)?.url ?? ''
  if (!url) throw new Error('Higgsfield status response has no video.url')
  return url as string
}

export async function higgsfieldWebhook(req: Request, res: Response): Promise<void> {
  try {
    const payload = req.body as Record<string, unknown>
    logger.info(`[Webhook] Higgsfield raw payload: ${JSON.stringify(payload)}`)

    const jobId    = (payload.request_id ?? (payload.data as any)?.id ?? payload.id ?? '') as string
    let   videoUrl = ((payload.video as any)?.url ?? payload.video_url ?? (payload.data as any)?.video_url ?? '') as string
    const errorMsg = (payload.error ?? (payload.data as any)?.error ?? '') as string
    const status   = (payload.status ?? payload.event ?? (payload.data as any)?.status ?? '') as string

    // Construct status_url from request_id when Higgsfield omits it from the webhook body
    const statusUrl = (payload.status_url as string | undefined)
      ?? (jobId ? `https://platform.higgsfield.ai/requests/${jobId}/status` : '')

    logger.info(`[Webhook] Higgsfield event — status=${status}, request_id=${jobId}, videoUrl=${videoUrl || '[empty]'}, status_url=${statusUrl || '[none]'}`)

    const isSuccess = status === 'generation.completed' || status === 'completed'
    const isFailure = status === 'generation.failed'    || status === 'failed'    || status === 'error'

    if (!isSuccess && !isFailure) {
      logger.info(`[Webhook] Higgsfield unhandled status: ${status}`)
      res.json({ success: true })
      return
    }

    // Find job by request_id stored in aiJobId
    const job = await VideoJob.findOne({ aiJobId: jobId })

    if (!job) {
      logger.warn(`[Webhook] Higgsfield: no job found for request_id=${jobId}`)
      res.status(404).json({ success: false, message: 'Job not found' })
      return
    }

    if (isSuccess) {
      // If the webhook body omitted video.url, fetch it from the status endpoint
      if (!videoUrl && statusUrl) {
        try {
          videoUrl = await fetchHiggsfieldVideoUrl(statusUrl)
          logger.info(`[Webhook] Higgsfield video URL fetched from status_url: ${videoUrl}`)
        } catch (err: any) {
          logger.error(`[Webhook] Failed to fetch Higgsfield video URL: ${err.message}`)
        }
      }

      if (!videoUrl) {
        logger.error(`[Webhook] Higgsfield: no video URL for job=${job.referenceId} — cannot proceed`)
        res.json({ success: true })
        return
      }

      job.rawVideoUrl = videoUrl
      logger.info(`[Webhook] Higgsfield video ready: job=${job.referenceId}, rawUrl=${videoUrl}`)

      const { syncLabsKey } = await settingsService.get()

      if (syncLabsKey && job.voiceAudioUrl) {
        // Lip-sync step: pass Higgsfield video + ElevenLabs audio to Sync.so
        try {
          const callbackUrl = env.serverUrl ? `${env.serverUrl}/api/webhooks/synclabs` : undefined
          const lipSync = await aiService.syncLabsLipSync({
            videoUrl:    videoUrl,
            audioUrl:    job.voiceAudioUrl,
            referenceId: job.referenceId,
            callbackUrl,
          })
          job.syncLabsJobId = lipSync.jobId
          logger.info(`[Webhook] Sync.so lip-sync queued: id=${lipSync.jobId}, job=${job.referenceId}`)
        } catch (err: any) {
          logger.error(`[Webhook] Sync.so submission failed for job=${job.referenceId}:`, err)
          // Fall back: use raw Higgsfield video without lip-sync
          job.finalVideoUrl  = videoUrl
          job.watermarkedUrl = videoUrl
          job.previewUrl     = videoUrl
          job.status         = 'review'
          job.statusHistory.push({ status: 'review', timestamp: new Date(), note: 'Sync.so failed — using raw Higgsfield video' })
        }
      } else {
        // No Sync.so key — advance directly to review with Higgsfield video
        job.finalVideoUrl  = videoUrl
        job.watermarkedUrl = videoUrl
        job.previewUrl     = videoUrl
        job.status         = 'review'
        job.statusHistory.push({ status: 'review', timestamp: new Date(), note: 'Higgsfield video ready — pending CS approval' })
        const { adminEmail } = await settingsService.get()
        if (adminEmail) {
          emailService.sendNewLeadNotification({ email: adminEmail } as any).catch(() => null)
        }
      }

      await job.save()
    } else {
      job.status       = 'failed'
      job.errorMessage = errorMsg || 'Higgsfield render failed'
      job.statusHistory.push({ status: 'failed', timestamp: new Date(), note: job.errorMessage })
      await job.save()
      logger.warn(`[Webhook] Higgsfield video failed: job=${job.referenceId}, error=${errorMsg}`)

      User.findById(job.userId).then(user => {
        if (user) emailService.sendJobStatusUpdate(user.email, user.name, 'failed', job.referenceId).catch(() => null)
      }).catch(() => null)
    }

    res.json({ success: true })
  } catch (err: any) {
    logger.error('[Webhook] Higgsfield webhook error:', err)
    res.status(200).json({ success: false, message: 'Internal error — logged' })
  }
}

// ── Sync.so webhook — lip-sync completion ─────────────────────────────────────

interface SyncLabsWebhookPayload {
  id?: string
  status?: string
  outputUrl?: string
  error?: string
  error_code?: string
}

export async function syncLabsWebhook(req: Request & { rawBody?: Buffer }, res: Response): Promise<void> {
  try {
    const { syncLabsWebhookSecret } = await settingsService.get()
    if (!verifySyncLabsSignature(req, syncLabsWebhookSecret)) {
      res.status(401).json({ success: false, message: 'Invalid signature' })
      return
    }

    const payload = req.body as SyncLabsWebhookPayload
    logger.info('[Webhook] Sync.so raw payload:', JSON.stringify(payload))

    const jobId    = payload.id ?? ''
    const status   = payload.status ?? ''
    const videoUrl = payload.outputUrl ?? ''
    const errorMsg = payload.error ?? payload.error_code ?? ''

    logger.info(`[Webhook] Sync.so event — status=${status}, id=${jobId}`)

    const isSuccess = status === 'COMPLETED'
    const isFailure = status === 'FAILED' || status === 'REJECTED'

    if (!isSuccess && !isFailure) {
      logger.info(`[Webhook] Sync.so unhandled status: ${status}`)
      res.json({ success: true })
      return
    }

    const job = await VideoJob.findOne({ syncLabsJobId: jobId })
    if (!job) {
      logger.warn(`[Webhook] Sync.so: no job found for id=${jobId}`)
      res.status(404).json({ success: false, message: 'Job not found' })
      return
    }

    if (isSuccess) {
      job.finalVideoUrl  = videoUrl
      job.watermarkedUrl = videoUrl
      job.previewUrl     = videoUrl
      job.status         = 'review'
      job.statusHistory.push({ status: 'review', timestamp: new Date(), note: 'Sync.so lip-sync complete — pending CS approval' })
      await job.save()
      logger.info(`[Webhook] Sync.so lip-sync complete: job=${job.referenceId}, url=${videoUrl}`)

      const { adminEmail } = await settingsService.get()
      if (adminEmail) {
        emailService.sendNewLeadNotification({ email: adminEmail } as any).catch(() => null)
      }
    } else {
      job.status       = 'failed'
      job.errorMessage = errorMsg || 'Sync.so lip-sync failed'
      job.statusHistory.push({ status: 'failed', timestamp: new Date(), note: job.errorMessage })
      await job.save()
      logger.warn(`[Webhook] Sync.so failed: job=${job.referenceId}, error=${errorMsg}`)

      User.findById(job.userId).then(user => {
        if (user) emailService.sendJobStatusUpdate(user.email, user.name, 'failed', job.referenceId).catch(() => null)
      }).catch(() => null)
    }

    res.json({ success: true })
  } catch (err: any) {
    logger.error('[Webhook] Sync.so webhook error:', err)
    res.status(200).json({ success: false, message: 'Internal error — logged' })
  }
}
