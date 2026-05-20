/**
 * Webhook Controller — handles inbound callbacks from Creatify Aurora and fal.ai.
 *
 * Creatify → /api/webhooks/creatify
 *   - status "done"   — set final_video_url, advance job to 'review'
 *   - status "failed" — mark job failed, notify customer
 *
 * fal.ai → /api/webhooks/fal
 *   - status "OK"    — download video, archive to S3, advance job to 'review'
 *   - status "ERROR" — mark job failed, notify customer
 */
import { Request, Response } from 'express'
import { Prisma } from '@prisma/client'
import prisma from '../lib/prisma'
import { settingsService } from '../services/settings.service'
import { emailService } from '../services/email.service'
import { applyWatermarkAndAdvanceJob } from '../services/watermark.service'
import { logger } from '../config/logger'

function makeJobAdapter(jobId: string, referenceId: string, initialData: Record<string, unknown>) {
  const data: Record<string, unknown> = { ...initialData }
  return {
    id:             jobId,
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

      const updatePayload: Record<string, unknown> = { status_history: merged }
      if (data.finalVideoUrl  !== undefined) updatePayload.final_video_url  = data.finalVideoUrl
      if (data.watermarkedUrl !== undefined) updatePayload.watermarked_url  = data.watermarkedUrl
      if (data.previewUrl     !== undefined) updatePayload.preview_url      = data.previewUrl
      if (data.status         !== undefined) {
        const s = data.status as string
        updatePayload.status = s === 'in-progress' ? 'in_progress' : s
      }
      await prisma.videoJob.update({ where: { id: jobId }, data: updatePayload })
    },
  }
}

export async function testWatermark(req: Request, res: Response): Promise<void> {
  try {
    const { videoUrl, referenceId } = req.body as { videoUrl?: string; referenceId?: string }

    let targetUrl = videoUrl
    const targetReferenceId = referenceId ?? `test-${Date.now()}`

    if (!targetUrl && referenceId) {
      const job = await prisma.videoJob.findFirst({ where: { reference_id: referenceId } })
      if (!job) {
        res.status(404).json({ success: false, message: `No job found for referenceId=${referenceId}` })
        return
      }
      targetUrl = job.final_video_url || job.preview_url || job.watermarked_url || undefined
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
      id:             'test',
      referenceId:    targetReferenceId,
      finalVideoUrl:  '',
      watermarkedUrl: '',
      previewUrl:     '',
      status:         'in-progress',
      statusHistory:  [] as unknown[],
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

// ── fal.ai webhook ────────────────────────────────────────────────────────────

interface FalWebhookPayload {
  request_id?: string
  status?: string      // "OK" = completed, "ERROR" = failed
  payload?: {
    video?: { url?: string; content_type?: string; file_name?: string; file_size?: number }
  }
  error?: string | null
}

export async function falWebhook(req: Request, res: Response): Promise<void> {
  try {
    const payload = req.body as FalWebhookPayload
    logger.info(`[Webhook] fal.ai raw payload: ${JSON.stringify(payload)}`)

    const requestId = payload.request_id ?? ''
    const status    = payload.status     ?? ''
    const falUrl    = payload.payload?.video?.url ?? ''
    const errorMsg  = payload.error      ?? ''

    logger.info(`[Webhook] fal.ai event — status=${status}, request_id=${requestId}`)

    if (status !== 'OK' && status !== 'ERROR') {
      logger.info(`[Webhook] fal.ai: unhandled status "${status}" — ignoring`)
      res.json({ success: true })
      return
    }

    const dbJob = await prisma.videoJob.findFirst({ where: { creatify_job_id: requestId } })
    if (!dbJob) {
      logger.warn(`[Webhook] fal.ai: no job found for request_id=${requestId}`)
      res.status(404).json({ success: false, message: 'Job not found' })
      return
    }

    if (status === 'OK') {
      if (!falUrl) {
        logger.error(`[Webhook] fal.ai: no video.url for job=${dbJob.reference_id} — cannot proceed`)
        res.json({ success: true })
        return
      }

      res.json({ success: true })

      settingsService.get().then(({ adminEmail }) => {
        if (adminEmail) emailService.sendNewLeadNotification({ email: adminEmail } as any).catch(() => null)
      }).catch(() => null)

      const jobAdapter = makeJobAdapter(dbJob.id, dbJob.reference_id, {
        finalVideoUrl:  dbJob.final_video_url  ?? '',
        watermarkedUrl: dbJob.watermarked_url  ?? '',
        previewUrl:     dbJob.preview_url      ?? '',
        status:         dbJob.status,
        statusHistory:  (Array.isArray(dbJob.status_history) ? dbJob.status_history : []) as unknown[],
      })

      applyWatermarkAndAdvanceJob(jobAdapter as any, falUrl)
        .then(() => logger.info(`[Webhook] Seedance complete: job=${dbJob.reference_id} → review`))
        .catch(err => logger.error(`[Webhook] applyWatermark failed for ${dbJob.reference_id}:`, err))
      return

    } else {
      const history = (Array.isArray(dbJob.status_history) ? dbJob.status_history : []) as Prisma.InputJsonValue[]
      const error_message = String(errorMsg || 'Seedance 2.0 render failed')
      const newHistory: Prisma.InputJsonValue = [
        ...history,
        { status: 'failed', timestamp: new Date().toISOString(), note: error_message },
      ]

      await prisma.videoJob.update({
        where: { id: dbJob.id },
        data: { status: 'failed', error_message, status_history: newHistory },
      })
      logger.warn(`[Webhook] Seedance failed: job=${dbJob.reference_id}, error=${errorMsg}`)

      prisma.user.findUnique({ where: { id: dbJob.user_id } }).then(user => {
        if (user) emailService.sendJobStatusUpdate(user.email, user.name, 'failed', dbJob.reference_id).catch(() => null)
      }).catch(() => null)
    }

    res.json({ success: true })
  } catch (err: any) {
    logger.error('[Webhook] fal.ai webhook error:', err)
    res.status(200).json({ success: false, message: 'Internal error — logged' })
  }
}

export async function creatifyWebhook(req: Request, res: Response): Promise<void> {
  try {
    const payload = req.body as Record<string, unknown>
    logger.info(`[Webhook] Creatify raw payload: ${JSON.stringify(payload)}`)

    const jobId    = (payload.id            ?? '') as string
    const status   = (payload.status        ?? '') as string
    const videoUrl = (payload.video_output  ?? '') as string
    const errorMsg = (payload.failed_reason ?? '') as string

    logger.info(`[Webhook] Creatify event — status=${status}, id=${jobId}, video_output=${videoUrl || '[empty]'}`)

    const outcome = status === 'done' ? 'success' : status === 'failed' ? 'failure' : null

    if (!outcome) {
      logger.info(`[Webhook] Creatify unhandled status: ${status}`)
      res.json({ success: true })
      return
    }

    const dbJob = await prisma.videoJob.findFirst({ where: { creatify_job_id: jobId } })
    if (!dbJob) {
      logger.warn(`[Webhook] Creatify: no job found for id=${jobId}`)
      res.status(404).json({ success: false, message: 'Job not found' })
      return
    }

    if (outcome === 'success') {
      if (!videoUrl) {
        logger.error(`[Webhook] Creatify: no video_output for job=${dbJob.reference_id} — cannot proceed`)
        res.json({ success: true })
        return
      }

      res.json({ success: true })

      settingsService.get().then(({ adminEmail }) => {
        if (adminEmail) emailService.sendNewLeadNotification({ email: adminEmail } as any).catch(() => null)
      }).catch(() => null)

      const jobAdapter = makeJobAdapter(dbJob.id, dbJob.reference_id, {
        finalVideoUrl:  dbJob.final_video_url  ?? '',
        watermarkedUrl: dbJob.watermarked_url  ?? '',
        previewUrl:     dbJob.preview_url      ?? '',
        status:         dbJob.status,
        statusHistory:  (Array.isArray(dbJob.status_history) ? dbJob.status_history : []) as unknown[],
      })

      applyWatermarkAndAdvanceJob(jobAdapter as any, videoUrl)
        .then(() => logger.info(`[Webhook] Job ${dbJob.reference_id} → review (watermarked)`))
        .catch(err => logger.error(`[Webhook] applyWatermarkAndAdvanceJob failed for job ${dbJob.reference_id}:`, err))
      return
    } else {
      const currentJob = await prisma.videoJob.findUnique({ where: { id: dbJob.id }, select: { status_history: true } })
      const history = (Array.isArray(currentJob?.status_history) ? currentJob!.status_history : []) as Prisma.InputJsonValue[]
      const error_message = errorMsg || 'Creatify Aurora render failed'
      const newHistory: Prisma.InputJsonValue = [...history, { status: 'failed', timestamp: new Date().toISOString(), note: error_message }]

      await prisma.videoJob.update({
        where: { id: dbJob.id },
        data: { status: 'failed', error_message, status_history: newHistory },
      })
      logger.warn(`[Webhook] Creatify failed: job=${dbJob.reference_id}, error=${errorMsg}`)

      prisma.user.findUnique({ where: { id: dbJob.user_id } }).then(user => {
        if (user) emailService.sendJobStatusUpdate(user.email, user.name, 'failed', dbJob.reference_id).catch(() => null)
      }).catch(() => null)
    }

    res.json({ success: true })
  } catch (err: any) {
    logger.error('[Webhook] Creatify webhook error:', err)
    res.status(200).json({ success: false, message: 'Internal error — logged' })
  }
}
