/**
 * Webhook Controller — handles inbound callbacks from Creatify Aurora.
 *
 * Creatify → /api/webhooks/creatify
 *   - status "done"   — set finalVideoUrl, advance job to 'review'
 *   - status "failed" — mark job failed, notify customer
 *
 * Register the URL in the Creatify dashboard (webhook_url param on each request).
 */
import { Request, Response } from 'express'
import { VideoJob } from '../models/VideoJob'
import { User } from '../models/User'
import { settingsService } from '../services/settings.service'
import { emailService } from '../services/email.service'
import { logger } from '../config/logger'

interface CreatifyWebhookPayload {
  id?: string
  status?: string
  video_output?: string
  failed_reason?: string
}

export async function creatifyWebhook(req: Request, res: Response): Promise<void> {
  try {
    const payload = req.body as CreatifyWebhookPayload
    logger.info(`[Webhook] Creatify raw payload: ${JSON.stringify(payload)}`)

    const jobId    = payload.id            ?? ''
    const status   = payload.status        ?? ''
    const videoUrl = payload.video_output  ?? ''
    const errorMsg = payload.failed_reason ?? ''

    logger.info(`[Webhook] Creatify event — status=${status}, id=${jobId}, video_output=${videoUrl || '[empty]'}`)

    const outcome = status === 'done' ? 'success' : status === 'failed' ? 'failure' : null

    if (!outcome) {
      logger.info(`[Webhook] Creatify unhandled status: ${status}`)
      res.json({ success: true })
      return
    }

    const job = await VideoJob.findOne({ creatifyJobId: jobId })
    if (!job) {
      logger.warn(`[Webhook] Creatify: no job found for id=${jobId}`)
      res.status(404).json({ success: false, message: 'Job not found' })
      return
    }

    if (outcome === 'success') {
      if (!videoUrl) {
        logger.error(`[Webhook] Creatify: no video_output for job=${job.referenceId} — cannot proceed`)
        res.json({ success: true })
        return
      }

      job.finalVideoUrl  = videoUrl
      job.watermarkedUrl = videoUrl
      job.previewUrl     = videoUrl
      job.status         = 'review'
      job.statusHistory.push({ status: 'review', timestamp: new Date(), note: 'Creatify Aurora complete — pending CS approval' })
      await job.save()
      logger.info(`[Webhook] Creatify complete: job=${job.referenceId}, url=${videoUrl}`)

      const { adminEmail } = await settingsService.get()
      if (adminEmail) {
        emailService.sendNewLeadNotification({ email: adminEmail } as any).catch(() => null)
      }
    } else {
      job.status       = 'failed'
      job.errorMessage = errorMsg || 'Creatify Aurora render failed'
      job.statusHistory.push({ status: 'failed', timestamp: new Date(), note: job.errorMessage })
      await job.save()
      logger.warn(`[Webhook] Creatify failed: job=${job.referenceId}, error=${errorMsg}`)

      User.findById(job.userId).then(user => {
        if (user) emailService.sendJobStatusUpdate(user.email, user.name, 'failed', job.referenceId).catch(() => null)
      }).catch(() => null)
    }

    res.json({ success: true })
  } catch (err: any) {
    logger.error('[Webhook] Creatify webhook error:', err)
    res.status(200).json({ success: false, message: 'Internal error — logged' })
  }
}
