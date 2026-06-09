import { Response, NextFunction } from 'express'
import prisma from '../lib/prisma'
import { AppError } from '../middleware/errorHandler'
import { AuthRequest } from '../middleware/auth'
import { generateGeminiImage } from '../services/gemini-image.service'
import { settingsService } from '../services/settings.service'
import { logger } from '../config/logger'

function generateRef(): string {
  const year = new Date().getFullYear()
  const seq  = Math.floor(Math.random() * 9000) + 1000
  return `TWN-${year}-${seq}`
}

export async function generateImageAd(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const {
      celebrityId,
      prompt,
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

    const referenceId = generateRef()

    const job = await prisma.videoJob.create({
      data: {
        reference_id:    referenceId,
        user_id:         req.userId!,
        celebrity_id:    celebrityId,
        product_type:    'image_ad',
        purpose:         'image-ad',
        script:          (prompt as string).trim(),
        aspect_ratio:    aspectRatio    || '16:9',
        channels:        channels       || [],
        scene_notes:     [
          (prompt as string).trim(),
          duration    ? `License duration: ${duration}` : '',
          territory   ? `Territory: ${territory}` : '',
          exclusivity ? `Exclusivity: ${exclusivity}` : '',
        ].filter(Boolean).join('. '),
        estimated_price: typeof estimatedPrice === 'number' ? estimatedPrice : 0,
        currency:        'SAR',
        status:          'in_progress',
        status_history:  [
          { status: 'pending',     timestamp: new Date().toISOString() },
          { status: 'in-progress', timestamp: new Date().toISOString(), note: 'Gemini image generation started' },
        ],
      },
    })

    // Gemini blocks prompts that reference real people or include their photos.
    // Generate a background scene / environment image — no people, no faces.
    // The celebrity photo is shown alongside it in the UI.
    const imagePrompt = [
      `Create a high-end advertising background scene for a brand campaign.`,
      `The image must contain NO people, NO faces, and NO human figures.`,
      `Campaign brief: ${(prompt as string).trim()}`,
      `Style: premium brand advertising, cinematic product photography, bold atmospheric composition.`,
      aspectRatio ? `Aspect ratio: ${aspectRatio}.` : '',
    ].filter(Boolean).join(' ')

    const { s3Bucket } = await settingsService.get()

    // Fire-and-forget: generate image and advance job to review
    generateGeminiImage({ prompt: imagePrompt, referenceId, s3Bucket })
      .then(async (result) => {
        await prisma.videoJob.update({
          where: { id: job.id },
          data:  {
            status:          'review',
            preview_url:     result.imageUrl,
            watermarked_url: result.imageUrl,
            final_video_url: result.imageUrl,
            status_history:  [
              { status: 'pending',     timestamp: new Date(job.created_at).toISOString() },
              { status: 'in-progress', timestamp: new Date().toISOString(), note: 'Gemini image generation started' },
              { status: 'review',      timestamp: new Date().toISOString(), note: result.status === 'stub' ? 'Stub image — ready for CS review' : 'Gemini image generated — pending CS review' },
            ],
          },
        })
        logger.info(`[ImageAd] Job ${referenceId} → review (${result.status})`)
      })
      .catch(async (err) => {
        logger.error(`[ImageAd] Gemini generation failed for ${referenceId}:`, err)
        await prisma.videoJob.update({
          where: { id: job.id },
          data:  { status: 'failed', error_message: err?.message ?? 'Gemini image generation failed' },
        })
      })

    res.status(201).json({
      success:     true,
      referenceId: job.reference_id,
      message:     'Image ad generation started — check My Requests for status updates',
    })

  } catch (err) {
    next(err)
  }
}
