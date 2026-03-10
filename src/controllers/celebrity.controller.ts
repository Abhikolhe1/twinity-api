import { Request, Response, NextFunction } from 'express'
import { Celebrity } from '../models/Celebrity'
import { AppError } from '../middleware/errorHandler'
import { aiService } from '../services/ai.service'
import { s3Service } from '../services/s3.service'
import { logger } from '../config/logger'

export async function listCelebrities(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { industry, search, featured } = req.query
    const filter: Record<string, unknown> = { isActive: true }
    if (industry && industry !== 'all') filter.industry = industry
    if (featured === 'true') filter.isFeatured = true
    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: 'i' } },
        { nameAr: { $regex: search, $options: 'i' } },
      ]
    }
    const celebrities = await Celebrity.find(filter).sort({ isFeatured: -1, totalOrders: -1 })
    res.json({ success: true, data: celebrities, total: celebrities.length })
  } catch (err) {
    next(err)
  }
}

export async function getCelebrity(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const celeb = await Celebrity.findOne({ slug: req.params.slug, isActive: true })
    if (!celeb) throw new AppError('Celebrity not found', 404)
    res.json({ success: true, data: celeb })
  } catch (err) {
    next(err)
  }
}

// Admin only
export async function createCelebrity(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const celeb = await Celebrity.create(req.body)
    res.status(201).json({ success: true, data: celeb })
  } catch (err) {
    next(err)
  }
}

export async function updateCelebrity(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const celeb = await Celebrity.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true })
    if (!celeb) throw new AppError('Celebrity not found', 404)
    res.json({ success: true, data: celeb })
  } catch (err) {
    next(err)
  }
}

export async function toggleCelebrityStatus(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const celeb = await Celebrity.findById(req.params.id)
    if (!celeb) throw new AppError('Celebrity not found', 404)
    celeb.isActive = !celeb.isActive
    await celeb.save()
    res.json({ success: true, data: celeb, message: `Celebrity ${celeb.isActive ? 'activated' : 'deactivated'}` })
  } catch (err) {
    next(err)
  }
}

export async function deleteCelebrity(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const celeb = await Celebrity.findByIdAndDelete(req.params.id)
    if (!celeb) throw new AppError('Celebrity not found', 404)
    res.json({ success: true, message: 'Celebrity deleted' })
  } catch (err) {
    next(err)
  }
}

export async function createCelebrityAvatar(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const celeb = await Celebrity.findById(req.params.id)
    if (!celeb) throw new AppError('Celebrity not found', 404)

    // Soul ID is created in the Higgsfield web dashboard, then stored here.
    // The admin passes the soulId in the request body.
    const { soulId } = req.body as { soulId?: string }
    if (!soulId || !soulId.trim()) {
      throw new AppError(
        'soulId is required. Create the Soul in the Higgsfield dashboard (https://cloud.higgsfield.ai/character) and paste the ID here.',
        400,
      )
    }

    logger.info(`[Celebrity] Registering Higgsfield Soul ID for: ${celeb.name}, soulId=${soulId}`)

    // Upload training assets (images + audio) to S3 if provided
    const files = req.files as { images?: Express.Multer.File[]; audio?: Express.Multer.File[] } | undefined
    const imageFiles = files?.images ?? []
    const audioFile  = files?.audio?.[0] ?? null

    if (imageFiles.length > 0 || audioFile) {
      logger.info(`[Celebrity] Uploading ${imageFiles.length} images + ${audioFile ? '1 audio' : 'no audio'} to S3 for: ${celeb.name}`)
      const { imageUrls, audioUrl } = await s3Service.uploadCelebrityAssets({
        slug:   celeb.slug,
        images: imageFiles.map(f => ({ originalname: f.originalname, buffer: f.buffer, mimetype: f.mimetype })),
        audio:  audioFile ? { originalname: audioFile.originalname, buffer: audioFile.buffer, mimetype: audioFile.mimetype } : null,
      })

      if (imageUrls.length > 0) celeb.trainingImageUrls = imageUrls
      if (audioUrl) celeb.trainingAudioUrl = audioUrl
      logger.info(`[Celebrity] Uploaded ${imageUrls.length} images and audio=${audioUrl ?? 'none'} for: ${celeb.name}`)
    }

    celeb.avatarModelId = soulId.trim()
    celeb.avatarStatus  = 'ready'
    await celeb.save()

    res.json({
      success: true,
      data: {
        avatarModelId:     celeb.avatarModelId,
        avatarStatus:      celeb.avatarStatus,
        trainingImageUrls: celeb.trainingImageUrls,
        trainingAudioUrl:  celeb.trainingAudioUrl,
      },
      message: `Soul ID saved for ${celeb.name}`,
    })
  } catch (err) {
    next(err)
  }
}
