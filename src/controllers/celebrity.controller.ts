import { Request, Response, NextFunction } from 'express'
import sharp from 'sharp'
import prisma from '../lib/prisma'
import { AppError } from '../middleware/errorHandler'
import { aiService } from '../services/ai.service'
import { s3Service } from '../services/s3.service'
import { settingsService } from '../services/settings.service'
import { logger } from '../config/logger'

async function maybeProcessThumbnail(thumbnailUrl: string | undefined, processThumbnail: boolean): Promise<string | undefined> {
  if (!processThumbnail) return thumbnailUrl
  if (!thumbnailUrl?.startsWith('data:')) return thumbnailUrl
  return aiService.processThumbnailImage(thumbnailUrl)
}

async function resolveThumbnailUrl(thumbnailUrl: string | undefined, slug: string): Promise<string | undefined> {
  if (!thumbnailUrl) return thumbnailUrl

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

async function signDoc(doc: Record<string, unknown>): Promise<Record<string, unknown>> {
  return { ...doc, thumbnail_url: await s3Service.presignIfS3(doc.thumbnail_url as string | undefined) }
}

export async function listCelebrities(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { industry, search, featured } = req.query
    const where: Record<string, unknown> = { is_active: true }
    if (industry && industry !== 'all') where.industry = industry
    if (featured === 'true') where.is_featured = true
    if (search) {
      where.OR = [
        { name:    { contains: search as string, mode: 'insensitive' } },
        { name_ar: { contains: search as string, mode: 'insensitive' } },
      ]
    }
    const raw = await prisma.celebrity.findMany({
      where,
      orderBy: [{ is_featured: 'desc' }, { total_orders: 'desc' }],
    })
    const data = await Promise.all(raw.map(c => signDoc(c as unknown as Record<string, unknown>)))
    res.json({ success: true, data, total: data.length })
  } catch (err) {
    next(err)
  }
}

export async function getCelebrity(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const raw = await prisma.celebrity.findFirst({ where: { slug: req.params.slug, is_active: true } })
    if (!raw) throw new AppError('Celebrity not found', 404)
    res.json({ success: true, data: await signDoc(raw as unknown as Record<string, unknown>) })
  } catch (err) {
    next(err)
  }
}

export async function createCelebrity(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = { ...req.body }
    const processThumbnail = Boolean(body.processThumbnail)
    delete body.processThumbnail
    const slug = body.slug || body.name?.toLowerCase().trim().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')
    body.thumbnail_url = await maybeProcessThumbnail(body.thumbnail_url ?? body.thumbnailUrl, processThumbnail)
    body.thumbnail_url = await resolveThumbnailUrl(body.thumbnail_url, slug)

    const celeb = await prisma.celebrity.create({
      data: {
        name:               body.name,
        name_ar:            body.name_ar ?? body.nameAr,
        slug,
        industry:           body.industry,
        nationality:        body.nationality,
        nationality_ar:     body.nationality_ar ?? body.nationalityAr,
        region:             body.region,
        contact_email:      body.contact_email ?? body.contactEmail,
        contact_phone:      body.contact_phone ?? body.contactPhone,
        languages:          Array.isArray(body.languages) ? body.languages : [],
        tags:               Array.isArray(body.tags) ? body.tags : [],
        tags_ar:            Array.isArray(body.tags_ar ?? body.tagsAr) ? (body.tags_ar ?? body.tagsAr) : [],
        bio:                body.bio,
        bio_ar:             body.bio_ar ?? body.bioAr,
        avatar_color:       body.avatar_color ?? body.avatarColor,
        initials:           body.initials,
        thumbnail_url:      body.thumbnail_url,
        voice_model_id:     body.voice_model_id ?? body.voiceModelId,
        training_audio_url: body.training_audio_url ?? body.trainingAudioUrl,
        is_active:          body.is_active ?? body.isActive ?? true,
        is_featured:        body.is_featured ?? body.isFeatured ?? false,
        onboarding_status:  body.onboarding_status ?? body.onboardingStatus ?? undefined,
        applied_at:         body.applied_at ?? body.appliedAt ?? undefined,
        reviewed_at:        body.reviewed_at ?? body.reviewedAt ?? undefined,
        review_notes:       body.review_notes ?? body.reviewNotes,
        price_range:        body.price_range ?? body.priceRange ?? undefined,
        total_orders:       body.total_orders ?? body.totalOrders ?? 0,
      },
    })
    res.status(201).json({ success: true, data: await signDoc(celeb as unknown as Record<string, unknown>) })
  } catch (err) {
    next(err)
  }
}

export async function updateCelebrity(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const existing = await prisma.celebrity.findUnique({ where: { id: req.params.id } })
    if (!existing) throw new AppError('Celebrity not found', 404)
    const body = { ...req.body }
    const processThumbnail = Boolean(body.processThumbnail)
    delete body.processThumbnail
    const rawThumb = body.thumbnail_url ?? body.thumbnailUrl
    const resolvedThumb = await resolveThumbnailUrl(
      await maybeProcessThumbnail(rawThumb, processThumbnail),
      existing.slug
    )

    const updateData: Record<string, unknown> = {}
    const fieldMap: Record<string, string> = {
      name: 'name', nameAr: 'name_ar', name_ar: 'name_ar',
      industry: 'industry', nationality: 'nationality',
      nationalityAr: 'nationality_ar', nationality_ar: 'nationality_ar',
      region: 'region', contactEmail: 'contact_email', contact_email: 'contact_email',
      contactPhone: 'contact_phone', contact_phone: 'contact_phone',
      languages: 'languages', tags: 'tags',
      tagsAr: 'tags_ar', tags_ar: 'tags_ar',
      bio: 'bio', bioAr: 'bio_ar', bio_ar: 'bio_ar',
      avatarColor: 'avatar_color', avatar_color: 'avatar_color',
      initials: 'initials',
      voiceModelId: 'voice_model_id', voice_model_id: 'voice_model_id',
      trainingAudioUrl: 'training_audio_url', training_audio_url: 'training_audio_url',
      isActive: 'is_active', is_active: 'is_active',
      isFeatured: 'is_featured', is_featured: 'is_featured',
      onboardingStatus: 'onboarding_status', onboarding_status: 'onboarding_status',
      appliedAt: 'applied_at', applied_at: 'applied_at',
      reviewedAt: 'reviewed_at', reviewed_at: 'reviewed_at',
      reviewNotes: 'review_notes', review_notes: 'review_notes',
      priceRange: 'price_range', price_range: 'price_range',
      totalOrders: 'total_orders', total_orders: 'total_orders',
    }
    for (const [key, dbKey] of Object.entries(fieldMap)) {
      if (key in body) updateData[dbKey] = body[key]
    }
    if (resolvedThumb !== undefined) updateData.thumbnail_url = resolvedThumb

    const celeb = await prisma.celebrity.update({
      where: { id: req.params.id },
      data: updateData,
    })
    res.json({ success: true, data: await signDoc(celeb as unknown as Record<string, unknown>) })
  } catch (err) {
    next(err)
  }
}

export async function toggleCelebrityStatus(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const existing = await prisma.celebrity.findUnique({ where: { id: req.params.id } })
    if (!existing) throw new AppError('Celebrity not found', 404)
    const celeb = await prisma.celebrity.update({
      where: { id: req.params.id },
      data: { is_active: !existing.is_active },
    })
    res.json({
      success: true,
      data: await signDoc(celeb as unknown as Record<string, unknown>),
      message: `Celebrity ${celeb.is_active ? 'activated' : 'deactivated'}`,
    })
  } catch (err) {
    next(err)
  }
}

export async function deleteCelebrity(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const celeb = await prisma.celebrity.findUnique({ where: { id: req.params.id } })
    if (!celeb) throw new AppError('Celebrity not found', 404)
    await prisma.celebrity.delete({ where: { id: req.params.id } })
    res.json({ success: true, message: 'Celebrity deleted' })
  } catch (err) {
    next(err)
  }
}

export async function cloneCelebrityVoice(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const celeb = await prisma.celebrity.findUnique({ where: { id: req.params.id } })
    if (!celeb) throw new AppError('Celebrity not found', 404)

    const files = req.files as { audio?: Express.Multer.File[] } | undefined
    const audioFiles = files?.audio ?? []

    if (audioFiles.length === 0) {
      throw new AppError('At least one audio sample file is required for voice cloning', 400)
    }

    const language = (req.body.language as string | undefined)?.trim() || 'en'
    const existingVoiceId = celeb.voice_model_id || undefined
    const action = existingVoiceId ? `editing existing voice ${existingVoiceId}` : 'creating new voice'
    logger.info(`[Celebrity] Cloning voice for: ${celeb.name}, ${action}, files=${audioFiles.length}, language=${language}`)

    const { voiceId } = await aiService.cloneVoice({
      name: `${celeb.name} — Twinity`,
      language,
      existingVoiceId,
      audioFiles: audioFiles.map(f => ({ buffer: f.buffer, originalname: f.originalname, mimetype: f.mimetype })),
    })

    await prisma.celebrity.update({
      where: { id: req.params.id },
      data: { voice_model_id: voiceId },
    })

    res.json({
      success: true,
      data: { voiceModelId: voiceId },
      message: `Voice cloned successfully for ${celeb.name}`,
    })
  } catch (err) {
    next(err)
  }
}
