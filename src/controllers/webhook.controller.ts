/**
 * Webhook Controller — handles inbound callbacks from Higgsfield AI.
 *
 * Higgsfield sends a POST to /api/webhooks/higgsfield when a job completes or fails.
 *
 * Security: we verify the X-Higgsfield-Secret header against the stored webhook secret.
 * If no secret is configured, the endpoint is open (acceptable for initial testing).
 *
 * Supported events:
 *   - Avatar training completed  → update Celebrity.avatarModelId + avatarStatus: 'ready'
 *   - Avatar training failed     → update Celebrity.avatarStatus: 'failed'
 *   - Video render completed     → run SyncLabs lip sync if voiceAudioUrl set, then status: 'review'
 *   - Video render failed        → update VideoJob status: 'failed'
 */
import { Request, Response } from 'express'
import { Celebrity } from '../models/Celebrity'
import { VideoJob } from '../models/VideoJob'
import { User } from '../models/User'
import { settingsService } from '../services/settings.service'
import { aiService } from '../services/ai.service'
import { emailService } from '../services/email.service'
import { logger } from '../config/logger'

// Higgsfield webhook payload format (https://docs.higgsfield.ai/how-to/webhooks)
interface HiggsfieldWebhookPayload {
  request_id?: string
  id?: string
  status_url?: string
  cancel_url?: string
  // status values: 'queued' | 'in_progress' | 'completed' | 'failed' | 'nsfw'
  status?: string
  output?: { character_id?: string; id?: string }
  // For video completion
  video?: { url: string }
  // For image completion
  images?: Array<{ url: string }>
  error?: string
}

export async function higgsfieldWebhook(req: Request, res: Response): Promise<void> {
  try {
    // Verify webhook secret if configured
    const { higgsfieldWebhookSecret } = await settingsService.get()
    if (higgsfieldWebhookSecret) {
      const incoming = req.headers['x-higgsfield-secret'] as string | undefined
      if (!incoming || incoming !== higgsfieldWebhookSecret) {
        logger.warn('[Webhook] Higgsfield secret mismatch — rejecting request')
        res.status(401).json({ success: false, message: 'Invalid webhook secret' })
        return
      }
    }

    const payload = req.body as HiggsfieldWebhookPayload
    const requestId = payload.request_id ?? payload.id

    if (!requestId) {
      res.status(400).json({ success: false, message: 'Missing request_id' })
      return
    }

    const status  = payload.status ?? 'unknown'
    const failed  = status === 'failed' || status === 'nsfw'
    const success = status === 'completed'

    logger.info(`[Webhook] Higgsfield event — requestId=${requestId}, status=${status}`)

    // ── Try to match as avatar training job ──────────────────────────────
    const celeb = await Celebrity.findOne({ avatarTrainingRequestId: requestId })
    if (celeb) {
      if (success) {
        const characterId = String(
          payload.output?.character_id ??
          payload.output?.id ??
          requestId
        )
        celeb.avatarModelId = characterId
        celeb.avatarStatus  = 'ready'
        logger.info(`[Webhook] Avatar training complete: celeb=${celeb.name}, characterId=${characterId}`)
      } else if (failed) {
        celeb.avatarStatus = 'failed'
        logger.warn(`[Webhook] Avatar training failed: celeb=${celeb.name}, error=${payload.error}`)
      }
      await celeb.save()
      res.json({ success: true, type: 'avatar', celebId: celeb._id })
      return
    }

    // ── Try to match as video render job ─────────────────────────────────
    const job = await VideoJob.findOne({ aiJobId: requestId })
    if (job) {
      if (success) {
        // Higgsfield sends video.url for video completions
        const rawVideoUrl = payload.video?.url ?? payload.images?.[0]?.url ?? ''
        logger.info(`[Webhook] Video render complete: job=${job.referenceId}, url=${rawVideoUrl}`)

        // ── SyncLabs lip sync ─────────────────────────────────────────────
        // If we have a voice audio URL (pre-generated ElevenLabs or training audio),
        // run it through SyncLabs to produce a lip-synced final video.
        let finalVideoUrl = rawVideoUrl

        if (job.voiceAudioUrl && rawVideoUrl) {
          try {
            logger.info(`[Webhook] Starting SyncLabs lip sync for job=${job.referenceId}`)
            const lipSync = await aiService.lipSync(rawVideoUrl, job.voiceAudioUrl)
            job.lipSyncJobId = lipSync.jobId
            finalVideoUrl    = lipSync.videoUrl
            logger.info(`[Webhook] SyncLabs lip sync complete: job=${job.referenceId}, videoUrl=${finalVideoUrl}`)
          } catch (lipSyncErr: any) {
            logger.warn(`[Webhook] SyncLabs lip sync failed for job=${job.referenceId}: ${lipSyncErr?.message} — using raw Higgsfield video`)
            // Fall back to raw Higgsfield video if SyncLabs fails
          }
        }

        job.finalVideoUrl  = finalVideoUrl
        job.watermarkedUrl = rawVideoUrl    // watermarked/preview = raw Higgsfield (before lip sync)
        job.previewUrl     = rawVideoUrl
        job.status         = 'review'
        job.statusHistory.push({
          status: 'review',
          timestamp: new Date(),
          note: job.voiceAudioUrl
            ? 'AI render + lip sync complete — pending CS approval'
            : 'AI render complete — pending CS approval',
        })
        await job.save()

        // Notify admin of new review item (non-blocking)
        const { adminEmail } = await settingsService.get()
        if (adminEmail) {
          emailService.sendNewLeadNotification({ email: adminEmail } as any).catch(() => null)
        }
      } else if (failed) {
        job.status       = 'failed'
        job.errorMessage = payload.error ?? 'Higgsfield render failed'
        job.statusHistory.push({ status: 'failed', timestamp: new Date(), note: job.errorMessage })
        await job.save()
        logger.warn(`[Webhook] Video render failed: job=${job.referenceId}`)

        // Notify customer (non-blocking)
        User.findById(job.userId).then(user => {
          if (user) emailService.sendJobStatusUpdate(user.email, user.name, 'failed', job.referenceId).catch(() => null)
        }).catch(() => null)
      }

      res.json({ success: true, type: 'video', jobId: job._id })
      return
    }

    // No match found
    logger.warn(`[Webhook] No entity found for requestId=${requestId}`)
    res.status(404).json({ success: false, message: `No job found for requestId: ${requestId}` })

  } catch (err: any) {
    logger.error('[Webhook] Higgsfield webhook error:', err)
    // Always return 200 to Higgsfield so it doesn't retry unnecessarily
    res.status(200).json({ success: false, message: 'Internal error — logged' })
  }
}
