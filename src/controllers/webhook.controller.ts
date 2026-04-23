/**
 * Webhook Controller — handles inbound callbacks from fal.ai.
 *
 * Two-step pipeline:
 *   Step 1 — Seedance 2.0: celebrity image → base video
 *   Step 2 — SyncLabs:     base video + ElevenLabs audio → lip-synced final video
 *
 * Both steps use the same POST /api/webhooks/fal endpoint.
 * Jobs are looked up by seedanceRequestId OR syncLabsRequestId to identify the step.
 *
 * fal.ai webhook payload: { status: "OK"|"ERROR", request_id, payload: { video: { url } } }
 */
import { Request, Response } from 'express'
import { VideoJob } from '../models/VideoJob'
import { User } from '../models/User'
import { settingsService } from '../services/settings.service'
import { s3Service } from '../services/s3.service'
import { emailService } from '../services/email.service'
import { aiService } from '../services/ai.service'
import { env } from '../config/env'
import { logger } from '../config/logger'

interface FalWebhookPayload {
  request_id?: string
  status?: string      // "OK" = completed, "ERROR" = failed
  payload?: {
    video?: { url?: string; content_type?: string; file_name?: string; file_size?: number }
  }
  error?: string | null
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

    const requestId = payload.request_id ?? ''
    const status    = payload.status ?? ''
    const falUrl    = payload.payload?.video?.url ?? ''
    const errorMsg  = payload.error ?? ''

    logger.info(`[Webhook] fal.ai event — status=${status}, request_id=${requestId}`)

    if (status !== 'OK' && status !== 'ERROR') {
      logger.info(`[Webhook] fal.ai: unhandled status "${status}" — ignoring`)
      res.json({ success: true })
      return
    }

    // Look up by seedanceRequestId OR syncLabsRequestId
    const job = await VideoJob.findOne({
      $or: [
        { seedanceRequestId: requestId },
        { syncLabsRequestId: requestId },
      ],
    })

    if (!job) {
      logger.warn(`[Webhook] fal.ai: no job found for request_id=${requestId}`)
      res.status(404).json({ success: false, message: 'Job not found' })
      return
    }

    const isSeedanceDone  = job.seedanceRequestId === requestId
    const isSyncLabsDone  = job.syncLabsRequestId === requestId

    if (status === 'OK') {
      if (!falUrl) {
        logger.error(`[Webhook] fal.ai: no video.url for job=${job.referenceId} — cannot proceed`)
        res.json({ success: true })
        return
      }

      if (isSeedanceDone) {
        // ── Step 1 complete: submit base video to SyncLabs for lip sync ──────
        logger.info(`[Webhook] Seedance complete for ${job.referenceId} — submitting to SyncLabs`)

        if (!job.voiceAudioUrl) {
          logger.error(`[Webhook] No voiceAudioUrl on job ${job.referenceId} — cannot submit to SyncLabs`)
          res.json({ success: true })
          return
        }

        const audioUrl     = (await s3Service.presignIfS3Short(job.voiceAudioUrl, 7200)) ?? job.voiceAudioUrl
        const callbackUrl  = env.serverUrl ? `${env.serverUrl}/api/webhooks/fal` : undefined

        const syncResult = await aiService.syncLabsLipsync({
          videoUrl:     falUrl,
          audioUrl,
          referenceId:  job.referenceId,
          callbackUrl,
        })

        job.syncLabsRequestId = syncResult.requestId
        await job.save()
        logger.info(`[Webhook] SyncLabs queued for ${job.referenceId}: request_id=${syncResult.requestId}`)

      } else if (isSyncLabsDone) {
        // ── Step 2 complete: archive final video, advance to review ───────────
        const { s3Bucket } = await settingsService.get()
        const videoUrl = await archiveVideoToS3(falUrl, job.referenceId, s3Bucket)

        job.finalVideoUrl  = videoUrl
        job.watermarkedUrl = videoUrl
        job.previewUrl     = videoUrl
        job.status         = 'review'
        job.statusHistory.push({ status: 'review', timestamp: new Date(), note: 'SyncLabs lipsync complete — pending CS approval' })
        await job.save()
        logger.info(`[Webhook] SyncLabs complete: job=${job.referenceId}, url=${videoUrl}`)

        const { adminEmail } = await settingsService.get()
        if (adminEmail) {
          emailService.sendNewLeadNotification({ email: adminEmail } as any).catch(() => null)
        }
      }

    } else {
      // ERROR from either step
      const step = isSeedanceDone ? 'Seedance' : 'SyncLabs'
      job.status       = 'failed'
      job.errorMessage = String(errorMsg || `${step} render failed`)
      job.statusHistory.push({ status: 'failed', timestamp: new Date(), note: job.errorMessage })
      await job.save()
      logger.warn(`[Webhook] ${step} failed: job=${job.referenceId}, error=${errorMsg}`)

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
