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
  event?: string
  data?: {
    id?: string
    status?: string
    video_url?: string
    error?: string
    metadata?: { callback_id?: string }
  }
  // some Higgsfield versions send fields at top level
  id?: string
  status?: string
  video_url?: string
  error?: string
  metadata?: { callback_id?: string }
}

export async function higgsfieldWebhook(req: Request, res: Response): Promise<void> {
  try {
    const payload = req.body as HiggsfieldWebhookPayload
    // Support both nested (data.xxx) and flat (xxx) shapes
    const eventName  = payload.event ?? (payload.data?.status ?? payload.status ?? '')
    const jobId      = payload.data?.id ?? payload.id ?? ''
    const videoUrl   = payload.data?.video_url ?? payload.video_url ?? ''
    const errorMsg   = payload.data?.error ?? payload.error ?? ''
    const callbackId = payload.data?.metadata?.callback_id ?? payload.metadata?.callback_id ?? ''

    logger.info(`[Webhook] Higgsfield event — event=${eventName}, job_id=${jobId}, callback_id=${callbackId}`)

    const isSuccess = eventName === 'generation.completed' || eventName === 'completed'
    const isFailure = eventName === 'generation.failed'    || eventName === 'failed'

    if (!isSuccess && !isFailure) {
      logger.info(`[Webhook] Higgsfield unhandled event: ${eventName}`)
      res.json({ success: true })
      return
    }

    // Find job by Higgsfield job_id (stored in aiJobId) or by referenceId (from metadata)
    const job = callbackId
      ? await VideoJob.findOne({ referenceId: callbackId })
      : await VideoJob.findOne({ aiJobId: jobId })

    if (!job) {
      logger.warn(`[Webhook] Higgsfield: no job found for job_id=${jobId}, callback_id=${callbackId}`)
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
