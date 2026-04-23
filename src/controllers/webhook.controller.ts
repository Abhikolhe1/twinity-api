/**
 * Webhook Controller — handles inbound callbacks from fal.ai (Seedance 2.0).
 *
 * fal.ai → /api/webhooks/fal
 *   - status "COMPLETED" — download temp video → archive to S3 → advance job to 'review'
 *   - status "FAILED"    — mark job failed
 *
 * Set SERVER_URL env var so the webhook URL is sent with each Seedance job submission.
 */
import { Request, Response } from 'express'
import { VideoJob } from '../models/VideoJob'
import { User } from '../models/User'
import { settingsService } from '../services/settings.service'
import { s3Service } from '../services/s3.service'
import { emailService } from '../services/email.service'
import { logger } from '../config/logger'

interface FalWebhookPayload {
  request_id?: string
  response_code?: number          // 200 = completed, non-200 = failed
  payload?: {
    video?: { url?: string; content_type?: string; file_name?: string; file_size?: number }
  }
  error?: string
}

async function archiveVideoToS3(
  falVideoUrl: string,
  referenceId: string,
  s3Bucket: string,
): Promise<string> {
  try {
    logger.info(`[Webhook] Downloading fal.ai video for ${referenceId}: ${falVideoUrl}`)
    const res = await fetch(falVideoUrl)
    if (!res.ok) throw new Error(`Download failed (${res.status})`)

    const buffer = Buffer.from(await res.arrayBuffer())
    const key    = `jobs/${referenceId}/final-video.mp4`
    const upload = await s3Service.upload(s3Bucket, key, buffer, 'video/mp4')

    if (upload.stub) {
      logger.info(`[Webhook] S3 stub — keeping fal.ai URL for ${referenceId}`)
      return falVideoUrl
    }

    const permanentUrl = await s3Service.getPresignedUrl(s3Bucket, upload.key, 60 * 60 * 24 * 7)
    logger.info(`[Webhook] Video archived to S3 for ${referenceId}: ${permanentUrl}`)
    return permanentUrl
  } catch (err) {
    logger.warn(`[Webhook] S3 archive failed for ${referenceId} (using fal URL as fallback): ${String(err)}`)
    return falVideoUrl
  }
}

export async function falWebhook(req: Request, res: Response): Promise<void> {
  try {
    const payload = req.body as FalWebhookPayload
    logger.info(`[Webhook] fal.ai raw payload: ${JSON.stringify(payload)}`)

    const requestId    = payload.request_id   ?? ''
    const responseCode = payload.response_code            // 200 = success, non-200 = failure
    const falUrl       = payload.payload?.video?.url ?? ''
    const errorMsg     = payload.error ?? ''

    logger.info(`[Webhook] fal.ai event — response_code=${responseCode}, request_id=${requestId}`)

    if (responseCode === undefined) {
      logger.info(`[Webhook] fal.ai: no response_code in payload — ignoring`)
      res.json({ success: true })
      return
    }

    const job = await VideoJob.findOne({ seedanceRequestId: requestId })
    if (!job) {
      logger.warn(`[Webhook] fal.ai: no job found for request_id=${requestId}`)
      res.status(404).json({ success: false, message: 'Job not found' })
      return
    }

    if (responseCode === 200) {
      if (!falUrl) {
        logger.error(`[Webhook] fal.ai: no video.url for job=${job.referenceId} — cannot proceed`)
        res.json({ success: true })
        return
      }

      const { s3Bucket } = await settingsService.get()
      const videoUrl = await archiveVideoToS3(falUrl, job.referenceId, s3Bucket)

      job.finalVideoUrl  = videoUrl
      job.watermarkedUrl = videoUrl
      job.previewUrl     = videoUrl
      job.status         = 'review'
      job.statusHistory.push({ status: 'review', timestamp: new Date(), note: 'Seedance 2.0 complete — pending CS approval' })
      await job.save()
      logger.info(`[Webhook] Seedance complete: job=${job.referenceId}, url=${videoUrl}`)

      const { adminEmail } = await settingsService.get()
      if (adminEmail) {
        emailService.sendNewLeadNotification({ email: adminEmail } as any).catch(() => null)
      }
    } else {
      job.status       = 'failed'
      job.errorMessage = errorMsg || `Seedance 2.0 render failed (response_code=${responseCode})`
      job.statusHistory.push({ status: 'failed', timestamp: new Date(), note: job.errorMessage })
      await job.save()
      logger.warn(`[Webhook] Seedance failed: job=${job.referenceId}, error=${errorMsg}`)

      User.findById(job.userId).then(user => {
        if (user) emailService.sendJobStatusUpdate(user.email, user.name, 'failed', job.referenceId).catch(() => null)
      }).catch(() => null)
    }

    res.json({ success: true })
  } catch (err: any) {
    logger.error('[Webhook] fal.ai webhook error:', err)
    res.status(200).json({ success: false, message: 'Internal error — logged' })
  }
}
