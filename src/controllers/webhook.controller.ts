/**
 * Webhook Controller — handles inbound callbacks from Creatify Aurora.
 *
 * Creatify → /api/webhooks/creatify
 *   - status "done"   — set finalVideoUrl, advance job to 'review'
 *   - status "failed" — mark job failed, notify customer
 */
import { Request, Response } from 'express'
import { Prisma } from '@prisma/client'
import prisma from '../lib/prisma'
import { settingsService } from '../services/settings.service'
import { emailService } from '../services/email.service'
import { applyWatermarkAndAdvanceJob } from '../services/watermark.service'
import { logger } from '../config/logger'

// Helper to create a job-like object that watermark service can work with
// The watermark service calls job.save() and mutates job fields — we adapt that pattern here.
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
      // Fetch current statusHistory to merge (since we're accumulating locally)
      const current = await prisma.videoJob.findUnique({ where: { id: jobId }, select: { statusHistory: true } })
      const existing = (Array.isArray(current?.statusHistory) ? current!.statusHistory : []) as unknown[]
      // data.statusHistory has new entries pushed onto it via the adapter
      const newEntries = (data.statusHistory as unknown[]).slice(existing.length)
      const merged = [...existing, ...newEntries]

      const updatePayload: Record<string, unknown> = {
        statusHistory: merged,
      }
      if (data.finalVideoUrl  !== undefined) updatePayload.finalVideoUrl  = data.finalVideoUrl
      if (data.watermarkedUrl !== undefined) updatePayload.watermarkedUrl = data.watermarkedUrl
      if (data.previewUrl     !== undefined) updatePayload.previewUrl     = data.previewUrl
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
      const job = await prisma.videoJob.findFirst({ where: { referenceId } })
      if (!job) {
        res.status(404).json({ success: false, message: `No job found for referenceId=${referenceId}` })
        return
      }
      targetUrl = job.finalVideoUrl || job.previewUrl || job.watermarkedUrl || undefined
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

    const dbJob = await prisma.videoJob.findFirst({ where: { creatifyJobId: jobId } })
    if (!dbJob) {
      logger.warn(`[Webhook] Creatify: no job found for id=${jobId}`)
      res.status(404).json({ success: false, message: 'Job not found' })
      return
    }

    if (outcome === 'success') {
      if (!videoUrl) {
        logger.error(`[Webhook] Creatify: no video_output for job=${dbJob.referenceId} — cannot proceed`)
        res.json({ success: true })
        return
      }

      // Respond to Creatify immediately — watermarking can take 30-60 s
      res.json({ success: true })

      settingsService.get().then(({ adminEmail }) => {
        if (adminEmail) emailService.sendNewLeadNotification({ email: adminEmail } as any).catch(() => null)
      }).catch(() => null)

      const jobAdapter = makeJobAdapter(dbJob.id, dbJob.referenceId, {
        finalVideoUrl:  dbJob.finalVideoUrl  ?? '',
        watermarkedUrl: dbJob.watermarkedUrl ?? '',
        previewUrl:     dbJob.previewUrl     ?? '',
        status:         dbJob.status,
        statusHistory:  (Array.isArray(dbJob.statusHistory) ? dbJob.statusHistory : []) as unknown[],
      })

      applyWatermarkAndAdvanceJob(jobAdapter as any, videoUrl)
        .then(() => logger.info(`[Webhook] Job ${dbJob.referenceId} → review (watermarked)`))
        .catch(err => logger.error(`[Webhook] applyWatermarkAndAdvanceJob failed for job ${dbJob.referenceId}:`, err))
      return
    } else {
      // failure path
      const currentJob = await prisma.videoJob.findUnique({ where: { id: dbJob.id }, select: { statusHistory: true } })
      const history = (Array.isArray(currentJob?.statusHistory) ? currentJob!.statusHistory : []) as Prisma.InputJsonValue[]
      const errorMessage = errorMsg || 'Creatify Aurora render failed'
      const newHistory: Prisma.InputJsonValue = [...history, { status: 'failed', timestamp: new Date().toISOString(), note: errorMessage }]

      await prisma.videoJob.update({
        where: { id: dbJob.id },
        data: { status: 'failed', errorMessage, statusHistory: newHistory },
      })
      logger.warn(`[Webhook] Creatify failed: job=${dbJob.referenceId}, error=${errorMsg}`)

      prisma.user.findUnique({ where: { id: dbJob.userId } }).then(user => {
        if (user) emailService.sendJobStatusUpdate(user.email, user.name, 'failed', dbJob.referenceId).catch(() => null)
      }).catch(() => null)
    }

    res.json({ success: true })
  } catch (err: any) {
    logger.error('[Webhook] Creatify webhook error:', err)
    res.status(200).json({ success: false, message: 'Internal error — logged' })
  }
}
