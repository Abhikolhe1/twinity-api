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
import { VideoJob } from '../models/VideoJob'
import { User } from '../models/User'
import { settingsService } from '../services/settings.service'
import { emailService } from '../services/email.service'
import { logger } from '../config/logger'

// ── Higgsfield webhook — video generation events ──────────────────────────────

interface HiggsfieldWebhookPayload {
  // Higgsfield standard payload shape (docs.higgsfield.ai)
  status?: string
  request_id?: string
  video?: { url?: string }
  error?: string
  // Legacy / alternate shapes (kept for resilience)
  event?: string
  id?: string
  video_url?: string
  data?: {
    id?: string
    status?: string
    video_url?: string
    error?: string
  }
}

export async function higgsfieldWebhook(req: Request, res: Response): Promise<void> {
  try {
    const payload = req.body as HiggsfieldWebhookPayload
    logger.info('[Webhook] Higgsfield raw payload:', JSON.stringify(payload))

    // request_id is the canonical Higgsfield field (matches what was returned when job was submitted)
    const jobId    = payload.request_id ?? payload.data?.id ?? payload.id ?? ''
    const videoUrl = payload.video?.url ?? payload.video_url ?? payload.data?.video_url ?? ''
    const errorMsg = payload.error ?? payload.data?.error ?? ''
    const status   = payload.status ?? payload.event ?? payload.data?.status ?? ''

    logger.info(`[Webhook] Higgsfield event — status=${status}, request_id=${jobId}`)

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
      job.finalVideoUrl  = videoUrl
      job.watermarkedUrl = videoUrl
      job.previewUrl     = videoUrl
      job.status         = 'review'
      job.statusHistory.push({
        status: 'review',
        timestamp: new Date(),
        note: 'Higgsfield lipsync complete — pending CS approval',
      })
      await job.save()
      logger.info(`[Webhook] Higgsfield video complete: job=${job.referenceId}, url=${videoUrl}`)

      const { adminEmail } = await settingsService.get()
      if (adminEmail) {
        emailService.sendNewLeadNotification({ email: adminEmail } as any).catch(() => null)
      }
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
