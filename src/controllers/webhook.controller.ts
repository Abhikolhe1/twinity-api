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
import { applyWatermarkAndAdvanceJob } from '../services/watermark.service'
import { logger } from '../config/logger'

export async function testWatermark(req: Request, res: Response): Promise<void> {
  try {
    const { videoUrl, referenceId } = req.body as { videoUrl?: string; referenceId?: string }

    let targetUrl = videoUrl
    const targetReferenceId = referenceId ?? `test-${Date.now()}`

    if (!targetUrl && referenceId) {
      const job = await VideoJob.findOne({ referenceId })
      if (!job) {
        res.status(404).json({ success: false, message: `No job found for referenceId=${referenceId}` })
        return
      }
      targetUrl = job.finalVideoUrl || job.previewUrl || job.watermarkedUrl
      if (!targetUrl) {
        res.status(400).json({ success: false, message: `Job ${referenceId} has no video URL` })
        return
      }
    }

    if (!targetUrl) {
      res.status(400).json({ success: false, message: 'Provide videoUrl or referenceId in body' })
      return
    }

    logger.info(`[TestWatermark] Starting on url=${targetUrl}, ref=${targetReferenceId}`)

    const fakeJob = {
      referenceId:    targetReferenceId,
      finalVideoUrl:  '',
      watermarkedUrl: '',
      previewUrl:     '',
      status:         'in-progress',
      statusHistory:  [],
      save:           async () => {},
    } as any

    await applyWatermarkAndAdvanceJob(fakeJob, targetUrl)

    res.json({
      success:        true,
      referenceId:    targetReferenceId,
      cleanUrl:       fakeJob.finalVideoUrl,
      watermarkedUrl: fakeJob.watermarkedUrl,
    })
  } catch (err: any) {
    logger.error('[TestWatermark] Error:', err)
    res.status(500).json({ success: false, message: err?.message ?? 'Watermark test failed' })
  }
}

export async function creatifyWebhook(req: Request, res: Response): Promise<void> {
  try {
    const payload = req.body as Record<string, unknown>
    logger.info(`[Webhook] Creatify raw payload: ${JSON.stringify(payload)}`)

    const jobId    = (payload.id           ?? '') as string
    const status   = (payload.status       ?? '') as string
    const videoUrl = (payload.video_output ?? '') as string
    const errorMsg = (payload.failed_reason ?? '') as string

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

      // Respond to Creatify immediately — watermarking can take 30-60 s and must not block the webhook
      res.json({ success: true })

      // Notify admin (non-blocking)
      settingsService.get().then(({ adminEmail }) => {
        if (adminEmail) emailService.sendNewLeadNotification({ email: adminEmail } as any).catch(() => null)
      }).catch(() => null)

      // Apply watermark and advance job to review in the background
      applyWatermarkAndAdvanceJob(job, videoUrl)
        .then(() => logger.info(`[Webhook] Job ${job.referenceId} → review (watermarked)`))
        .catch(err => logger.error(`[Webhook] applyWatermarkAndAdvanceJob failed for job ${job.referenceId}:`, err))
      return
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
