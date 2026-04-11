import { Request, Response, NextFunction } from 'express'
import sharp from 'sharp'
import { Celebrity } from '../models/Celebrity'
import { AppError } from '../middleware/errorHandler'
import { aiService } from '../services/ai.service'
import { s3Service } from '../services/s3.service'
import { settingsService } from '../services/settings.service'
import { logger } from '../config/logger'

/**
 * When processThumbnail is true and thumbnailUrl is a fresh base64 data URL,
 * run the image through Gemini using the thumbnailProcessPrompt from settings.
 */
async function maybeProcessThumbnail(thumbnailUrl: string | undefined, processThumbnail: boolean): Promise<string | undefined> {
  if (!processThumbnail) return thumbnailUrl
  if (!thumbnailUrl?.startsWith('data:')) return thumbnailUrl
  return aiService.processThumbnailImage(thumbnailUrl)
}

/**
 * If thumbnailUrl is a base64 data URL (set by the admin file picker), convert
 * it to JPEG and upload to S3.
 */
async function resolveThumbnailUrl(thumbnailUrl: string | undefined, slug: string): Promise<string | undefined> {
  if (!thumbnailUrl) return thumbnailUrl

  // Strip pre-signed query params so we always store the clean S3 URL.
  // When the edit form saves without changing the image it sends back the
  // pre-signed URL that was loaded — storing it as-is would corrupt the key.
  if (thumbnailUrl.includes('amazonaws.com/') && thumbnailUrl.includes('?')) {
    thumbnailUrl = thumbnailUrl.split('?')[0]
  }

  if (!thumbnailUrl.startsWith('data:')) return thumbnailUrl

  const match = thumbnailUrl.match(/^data:([^;]+);base64,(.+)$/)
  if (!match) return thumbnailUrl

  const rawBuffer = Buffer.from(match[2], 'base64')
  const jpegBuffer = await sharp(rawBuffer).jpeg({ quality: 90 }).toBuffer()

  const { s3Bucket } = await settingsService.get()
  const key = `celebrities/${slug}/thumbnail.jpg`
  const result = await s3Service.upload(s3Bucket, key, jpegBuffer, 'image/jpeg')
  logger.info(`[Celebrity] Thumbnail converted to JPEG and uploaded to S3: ${result.url}`)
  return result.url
}

async function signDoc(doc: object): Promise<Record<string, unknown>> {
  const plain = doc as Record<string, unknown>
  return { ...plain, thumbnailUrl: await s3Service.presignIfS3(plain.thumbnailUrl as string | undefined) }
}

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
    const raw = await Celebrity.find(filter).sort({ isFeatured: -1, totalOrders: -1 }).lean()
    const data = await Promise.all(raw.map(signDoc))
    res.json({ success: true, data, total: data.length })
  } catch (err) {
    next(err)
  }
}

export async function getCelebrity(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const raw = await Celebrity.findOne({ slug: req.params.slug, isActive: true }).lean()
    if (!raw) throw new AppError('Celebrity not found', 404)
    res.json({ success: true, data: await signDoc(raw) })
  } catch (err) {
    next(err)
  }
}

// Admin only
export async function createCelebrity(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = { ...req.body }
    const processThumbnail = Boolean(body.processThumbnail)
    delete body.processThumbnail
    const slug = body.slug || body.name?.toLowerCase().trim().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')
    body.thumbnailUrl = await maybeProcessThumbnail(body.thumbnailUrl, processThumbnail)
    body.thumbnailUrl = await resolveThumbnailUrl(body.thumbnailUrl, slug)
    const celeb = await Celebrity.create(body)
    res.status(201).json({ success: true, data: await signDoc(celeb.toObject()) })
  } catch (err) {
    next(err)
  }
}

export async function updateCelebrity(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const existing = await Celebrity.findById(req.params.id)
    if (!existing) throw new AppError('Celebrity not found', 404)
    const body = { ...req.body }
    const processThumbnail = Boolean(body.processThumbnail)
    delete body.processThumbnail
    body.thumbnailUrl = await maybeProcessThumbnail(body.thumbnailUrl, processThumbnail)
    body.thumbnailUrl = await resolveThumbnailUrl(body.thumbnailUrl, existing.slug)
    const celeb = await Celebrity.findByIdAndUpdate(req.params.id, body, { new: true, runValidators: true, lean: true })
    res.json({ success: true, data: await signDoc(celeb as Record<string, unknown>) })
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
    res.json({ success: true, data: await signDoc(celeb.toObject()), message: `Celebrity ${celeb.isActive ? 'activated' : 'deactivated'}` })
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

export async function cloneCelebrityVoice(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const celeb = await Celebrity.findById(req.params.id)
    if (!celeb) throw new AppError('Celebrity not found', 404)

    const files = req.files as { audio?: Express.Multer.File[] } | undefined
    const audioFiles = files?.audio ?? []

    if (audioFiles.length === 0) {
      throw new AppError('At least one audio sample file is required for voice cloning', 400)
    }

    const language = (req.body.language as string | undefined)?.trim() || 'en'
    const existingVoiceId = celeb.voiceModelId || undefined
    const action = existingVoiceId ? `editing existing voice ${existingVoiceId}` : 'creating new voice'
    logger.info(`[Celebrity] Cloning voice for: ${celeb.name}, ${action}, files=${audioFiles.length}, language=${language}`)

    const { voiceId } = await aiService.cloneVoice({
      name: `${celeb.name} — Twinity`,
      language,
      existingVoiceId,
      audioFiles: audioFiles.map(f => ({ buffer: f.buffer, originalname: f.originalname, mimetype: f.mimetype })),
    })

    celeb.voiceModelId = voiceId
    await celeb.save()

    res.json({
      success: true,
      data: { voiceModelId: voiceId },
      message: `Voice cloned successfully for ${celeb.name}`,
    })
  } catch (err) {
    next(err)
  }
}
