/**
 * Webhook Controller — handles inbound callbacks from HeyGen.
 *
 * HeyGen sends a POST to /api/webhooks/heygen for both avatar training
 * and video generation events. Register this URL in the HeyGen dashboard.
 * HeyGen does not sign webhook payloads; security relies on the URL
 * being private/unguessable in production.
 *
 * Supported events:
 *   - avatar_training.success — avatar group ready; trigger video generation
 *   - avatar_training.fail    — mark job failed
 *   - avatar_video.success    — update job URLs, advance status to 'review'
 *   - avatar_video.fail       — update job status to 'failed', notify customer
 */
import { Request, Response } from 'express'
import { VideoJob } from '../models/VideoJob'
import { User } from '../models/User'
import { settingsService } from '../services/settings.service'
import { emailService } from '../services/email.service'
import { queueService } from '../services/queue.service'
import { logger } from '../config/logger'

interface HeyGenWebhookPayload {
  event_type: string
  event_data: {
    video_id?: string
    group_id?: string
    url?: string
    thumbnail_url?: string
    gif_url?: string
    callback_id?: string
    duration?: number
    error?: string
    error_msg?: string
  }
}

export async function heygenWebhook(req: Request, res: Response): Promise<void> {
  try {
    const payload = req.body as HeyGenWebhookPayload
    const { event_type, event_data } = payload
    const videoId = event_data?.video_id

    logger.info(`[Webhook] HeyGen event — event_type=${event_type}, video_id=${videoId}, group_id=${event_data?.group_id}`)

    // ── Avatar training events ────────────────────────────────────────────────
    if (event_type === 'avatar_training.success' || event_type === 'avatar_training.fail') {
      const groupId = event_data?.group_id
      if (!groupId) {
        logger.warn('[Webhook] HeyGen avatar_training event missing group_id')
        res.json({ success: true })
        return
      }
      const trainingJob = await VideoJob.findOne({ aiJobId: groupId, status: 'in-progress' })
      if (!trainingJob) {
        logger.warn(`[Webhook] HeyGen: no in-progress job found for group_id=${groupId}`)
        res.json({ success: true })
        return
      }
      if (event_type === 'avatar_training.success') {
        logger.info(`[Webhook] HeyGen avatar training complete for group_id=${groupId}, job=${trainingJob.referenceId} — triggering video generation`)
        await queueService.triggerVideoGeneration(String(trainingJob._id))
      } else {
        const errMsg = event_data.error_msg ?? event_data.error ?? 'Avatar training failed'
        trainingJob.status = 'failed'
        trainingJob.errorMessage = errMsg
        trainingJob.statusHistory.push({ status: 'failed', timestamp: new Date(), note: errMsg })
        await trainingJob.save()
        logger.warn(`[Webhook] HeyGen avatar training failed for job=${trainingJob.referenceId}: ${errMsg}`)
      }
      res.json({ success: true })
      return
    }

    // ── Video generation events ───────────────────────────────────────────────
    if (!videoId) {
      logger.warn('[Webhook] HeyGen: missing video_id in payload')
      res.status(400).json({ success: false, message: 'Missing video_id' })
      return
    }

    const job = await VideoJob.findOne({ aiJobId: videoId })
    if (!job) {
      logger.warn(`[Webhook] HeyGen: no job found for video_id=${videoId}`)
      res.status(404).json({ success: false, message: `No job found for video_id: ${videoId}` })
      return
    }

    if (event_type === 'avatar_video.success') {
      const videoUrl = event_data.url ?? ''
      job.finalVideoUrl  = videoUrl
      job.watermarkedUrl = videoUrl
      job.previewUrl     = videoUrl
      job.status         = 'review'
      job.statusHistory.push({
        status: 'review',
        timestamp: new Date(),
        note: 'HeyGen lip-sync complete — pending CS approval',
      })
      await job.save()
      logger.info(`[Webhook] HeyGen video complete: job=${job.referenceId}, url=${videoUrl}`)

      // Notify admin of new review item (non-blocking)
      const { adminEmail } = await settingsService.get()
      if (adminEmail) {
        emailService.sendNewLeadNotification({ email: adminEmail } as any).catch(() => null)
      }
    } else if (event_type === 'avatar_video.fail') {
      job.status       = 'failed'
      job.errorMessage = event_data.error ?? 'HeyGen render failed'
      job.statusHistory.push({ status: 'failed', timestamp: new Date(), note: job.errorMessage })
      await job.save()
      logger.warn(`[Webhook] HeyGen video failed: job=${job.referenceId}, error=${event_data.error}`)

      // Notify customer (non-blocking)
      User.findById(job.userId).then(user => {
        if (user) emailService.sendJobStatusUpdate(user.email, user.name, 'failed', job.referenceId).catch(() => null)
      }).catch(() => null)
    } else {
      logger.info(`[Webhook] HeyGen unhandled event_type: ${event_type}`)
    }

    res.json({ success: true })
  } catch (err: any) {
    logger.error('[Webhook] HeyGen webhook error:', err)
    // Return 200 so HeyGen does not retry unnecessarily
    res.status(200).json({ success: false, message: 'Internal error — logged' })
  }
}
