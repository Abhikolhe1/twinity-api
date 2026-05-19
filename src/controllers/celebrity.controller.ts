import { Request, Response, NextFunction } from 'express'
import sharp from 'sharp'
import prisma from '../lib/prisma'
import { AppError } from '../middleware/errorHandler'
import { aiService } from '../services/ai.service'
import { s3Service } from '../services/s3.service'
import { settingsService } from '../services/settings.service'
import { logger } from '../config/logger'
import type { Celebrity } from '@prisma/client'

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
  return { ...doc, thumbnailUrl: await s3Service.presignIfS3(doc.thumbnailUrl as string | undefined) }
}

export async function listCelebrities(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { industry, search, featured } = req.query
    const where: Record<string, unknown> = { isActive: true }
    if (industry && industry !== 'all') where.industry = industry
    if (featured === 'true') where.isFeatured = true
    if (search) {
      where.OR = [
        { name: { contains: search as string, mode: 'insensitive' } },
        { nameAr: { contains: search as string, mode: 'insensitive' } },
      ]
    }
    const raw = await prisma.celebrity.findMany({
      where,
      orderBy: [{ isFeatured: 'desc' }, { totalOrders: 'desc' }],
    })
    const data = await Promise.all(raw.map(c => signDoc(c as unknown as Record<string, unknown>)))
    res.json({ success: true, data, total: data.length })
  } catch (err) {
    next(err)
  }
}

export async function getCelebrity(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const raw = await prisma.celebrity.findFirst({ where: { slug: req.params.slug, isActive: true } })
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
    body.thumbnailUrl = await maybeProcessThumbnail(body.thumbnailUrl, processThumbnail)
    body.thumbnailUrl = await resolveThumbnailUrl(body.thumbnailUrl, slug)

    // Ensure arrays and defaults
    const celeb = await prisma.celebrity.create({
      data: {
        name:          body.name,
        nameAr:        body.nameAr,
        slug,
        industry:      body.industry,
        nationality:   body.nationality,
        nationalityAr: body.nationalityAr,
        languages:     Array.isArray(body.languages) ? body.languages : [],
        tags:          Array.isArray(body.tags) ? body.tags : [],
        tagsAr:        Array.isArray(body.tagsAr) ? body.tagsAr : [],
        bio:           body.bio,
        bioAr:         body.bioAr,
        avatarColor:   body.avatarColor,
        initials:      body.initials,
        thumbnailUrl:  body.thumbnailUrl,
        voiceModelId:  body.voiceModelId,
        trainingAudioUrl: body.trainingAudioUrl,
        isActive:      body.isActive ?? true,
        isFeatured:    body.isFeatured ?? false,
        priceRange:    body.priceRange ?? undefined,
        totalOrders:   body.totalOrders ?? 0,
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
    body.thumbnailUrl = await maybeProcessThumbnail(body.thumbnailUrl, processThumbnail)
    body.thumbnailUrl = await resolveThumbnailUrl(body.thumbnailUrl, existing.slug)

    // Build update data — only include fields that were sent
    const updateData: Record<string, unknown> = {}
    const allowedFields = [
      'name','nameAr','industry','nationality','nationalityAr','languages','tags','tagsAr',
      'bio','bioAr','avatarColor','initials','thumbnailUrl','voiceModelId','trainingAudioUrl',
      'isActive','isFeatured','priceRange','totalOrders',
    ]
    for (const field of allowedFields) {
      if (field in body) updateData[field] = body[field]
    }

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
      data: { isActive: !existing.isActive },
    })
    res.json({
      success: true,
      data: await signDoc(celeb as unknown as Record<string, unknown>),
      message: `Celebrity ${celeb.isActive ? 'activated' : 'deactivated'}`,
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
    const existingVoiceId = celeb.voiceModelId || undefined
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
      data: { voiceModelId: voiceId },
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
