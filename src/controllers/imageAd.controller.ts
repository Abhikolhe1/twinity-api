import { Response, NextFunction } from 'express'
import prisma from '../lib/prisma'
import { AppError } from '../middleware/errorHandler'
import { AuthRequest } from '../middleware/auth'
import { falVideoService } from '../services/fal-video.service'
import { s3Service } from '../services/s3.service'
import { env } from '../config/env'
import { logger } from '../config/logger'

function generateRef(): string {
  const year = new Date().getFullYear()
  const seq  = Math.floor(Math.random() * 9000) + 1000
  return `TWN-${year}-${seq}`
}

export async function generateVideoAd(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const {
      celebrityId,
      prompt,
      style,
      aspectRatio,
      channels,
      duration,
      territory,
      exclusivity,
      estimatedPrice,
    } = req.body

    if (!celebrityId) throw new AppError('celebrityId is required', 400)
    if (!prompt || (prompt as string).trim().length < 10) throw new AppError('prompt must be at least 10 characters', 400)

    const celeb = await prisma.celebrity.findUnique({ where: { id: celebrityId } })
    if (!celeb || !celeb.is_active) throw new AppError('Celebrity not found or inactive', 404)

    if (!celeb.thumbnail_url) throw new AppError('Celebrity has no photo — upload one via the admin panel', 422)

    const referenceId = generateRef()

    const job = await prisma.videoJob.create({
      data: {
        reference_id:    referenceId,
        user_id:         req.userId!,
        celebrity_id:    celebrityId,
        product_type:    'image_ad',
        purpose:         'video-ad',
        script:          (prompt as string).trim(),
        aspect_ratio:    aspectRatio || '16:9',
        channels:        channels    || [],
        scene_notes:     [(prompt as string).trim(), style ? `Style: ${style}` : ''].filter(Boolean).join('. '),
        estimated_price: typeof estimatedPrice === 'number' ? estimatedPrice : 0,
        currency:        'SAR',
        status:          'in_progress',
        status_history:  [
          { status: 'pending',     timestamp: new Date().toISOString() },
          { status: 'in-progress', timestamp: new Date().toISOString(), note: 'Seedance 2.0 video generation started' },
        ],
      },
    })

    const imageUrl = (await s3Service.presignIfS3Short(celeb.thumbnail_url, 7200)) ?? celeb.thumbnail_url
    const callbackUrl = env.serverUrl ? `${env.serverUrl}/api/webhooks/fal` : undefined
    const videoPrompt = [
      (prompt as string).trim(),
      style ? `Visual style: ${style}` : '',
      duration   ? `License duration: ${duration}` : '',
      territory  ? `Territory: ${territory}` : '',
      exclusivity ? 'Exclusive usage rights' : '',
    ].filter(Boolean).join('. ')

    falVideoService.submit({ imageUrl, referenceId, callbackUrl, videoPrompt })
      .then(result => {
        logger.info(`[ImageAd] Seedance submitted for ${referenceId}: requestId=${result.requestId}`)
        return prisma.videoJob.update({
          where: { id: job.id },
          data:  { creatify_job_id: result.requestId },
        })
      })
      .catch(err => {
        logger.error(`[ImageAd] Seedance submit failed for ${referenceId}:`, err)
        prisma.videoJob.update({
          where: { id: job.id },
          data:  { status: 'failed', error_message: err?.message ?? 'Seedance submission failed' },
        }).catch(() => null)
      })

    res.status(201).json({
      success:     true,
      referenceId: job.reference_id,
      message:     'Video ad generation started — check My Requests for status updates',
    })

  } catch (err) {
    next(err)
  }
}
