import { Request, Response } from 'express'
import prisma from '../lib/prisma'
import { s3Service } from '../services/s3.service'
import { settingsService } from '../services/settings.service'
import { generateCompositeImage } from '../services/template-asset.service'

const db = prisma as any

export async function listTemplateAssets(req: Request, res: Response): Promise<void> {
  try {
    const { templateId } = req.query
    const where: Record<string, unknown> = templateId ? { template_id: templateId as string } : {}

    const assets = await db.templateCelebrityAsset.findMany({
      where,
      include: {
        celebrity: { select: { id: true, name: true, thumbnail_url: true, initials: true, avatar_color: true } },
        template: { select: { id: true, name: true, background_image_url: true } },
      },
      orderBy: { created_at: 'desc' },
    })

    const data = await Promise.all(
      assets.map(async (asset: any) => ({
        ...asset,
        composite_image_url: await s3Service.presignIfS3(asset.composite_image_url),
      })),
    )

    res.json({ success: true, data })
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message })
  }
}

export async function generateAsset(req: Request, res: Response): Promise<void> {
  try {
    const { templateId, celebrityId } = req.body
    if (!templateId || !celebrityId) {
      res.status(400).json({ success: false, message: 'templateId and celebrityId are required' })
      return
    }

    const [template, celebrity] = await Promise.all([
      db.template.findUnique({ where: { id: templateId } }),
      prisma.celebrity.findUnique({ where: { id: celebrityId } }),
    ])

    if (!template) {
      res.status(404).json({ success: false, message: 'Template not found' })
      return
    }
    if (!celebrity) {
      res.status(404).json({ success: false, message: 'Celebrity not found' })
      return
    }
    if (!template.background_image_url) {
      res.status(400).json({ success: false, message: 'Template has no background image' })
      return
    }
    if (!celebrity.thumbnail_url) {
      res.status(400).json({ success: false, message: 'Celebrity has no thumbnail image' })
      return
    }

    const backgroundUrl = (await s3Service.presignIfS3(template.background_image_url)) ?? template.background_image_url
    const celebrityUrl = (await s3Service.presignIfS3(celebrity.thumbnail_url)) ?? celebrity.thumbnail_url

    const referenceId = `${templateId.slice(-8)}-${celebrityId.slice(-8)}-${Date.now()}`
    const compositeUrl = await generateCompositeImage({
      celebrityImageUrl: celebrityUrl!,
      backgroundImageUrl: backgroundUrl!,
      referenceId,
    })

    const asset = await db.templateCelebrityAsset.upsert({
      where: { template_id_celebrity_id: { template_id: templateId, celebrity_id: celebrityId } },
      create: { template_id: templateId, celebrity_id: celebrityId, composite_image_url: compositeUrl },
      update: { composite_image_url: compositeUrl },
    })

    const presigned = await s3Service.presignIfS3(asset.composite_image_url)
    res.json({ success: true, data: { ...asset, composite_image_url: presigned } })
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message })
  }
}

export async function getCompositeForPair(req: Request, res: Response): Promise<void> {
  try {
    const { templateId, celebrityId } = req.query
    if (!templateId || !celebrityId) {
      res.status(400).json({ success: false, message: 'templateId and celebrityId are required' })
      return
    }

    const asset = await db.templateCelebrityAsset.findUnique({
      where: { template_id_celebrity_id: { template_id: templateId as string, celebrity_id: celebrityId as string } },
    })

    if (!asset) {
      res.json({ success: true, data: null })
      return
    }

    const compositeUrl = (await s3Service.presignIfS3(asset.composite_image_url)) ?? asset.composite_image_url
    res.json({ success: true, data: { ...asset, composite_image_url: compositeUrl } })
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message })
  }
}

export async function uploadAsset(req: Request, res: Response): Promise<void> {
  try {
    const { templateId, celebrityId, dataUrl } = req.body as { templateId?: string; celebrityId?: string; dataUrl?: string }
    if (!templateId || !celebrityId || !dataUrl) {
      res.status(400).json({ success: false, message: 'templateId, celebrityId, and dataUrl are required' })
      return
    }

    const match = dataUrl.match(/^data:(image\/[^;]+);base64,(.+)$/)
    if (!match) {
      res.status(400).json({ success: false, message: 'dataUrl must be a valid base64 image data URL' })
      return
    }

    const mimeType = match[1]
    const ext = mimeType.split('/')[1]?.split(';')[0] || 'png'
    const buffer = Buffer.from(match[2], 'base64')
    const { s3Bucket } = await settingsService.get()
    const key = `template-assets/${templateId.slice(-8)}-${celebrityId.slice(-8)}-${Date.now()}.${ext}`
    const upload = await s3Service.upload(s3Bucket, key, buffer, mimeType)

    const asset = await db.templateCelebrityAsset.upsert({
      where: { template_id_celebrity_id: { template_id: templateId, celebrity_id: celebrityId } },
      create: { template_id: templateId, celebrity_id: celebrityId, composite_image_url: upload.url },
      update: { composite_image_url: upload.url },
    })

    const presigned = await s3Service.presignIfS3(asset.composite_image_url)
    res.json({ success: true, data: { ...asset, composite_image_url: presigned } })
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message })
  }
}

export async function updateAssetTtsModel(req: Request, res: Response): Promise<void> {
  try {
    const { ttsModel } = req.body as { ttsModel?: string }
    const validModels = ['eleven_v3', 'eleven_multilingual_v2']
    if (!ttsModel || !validModels.includes(ttsModel)) {
      res.status(400).json({ success: false, message: 'Invalid ttsModel value' })
      return
    }
    const asset = await db.templateCelebrityAsset.findUnique({ where: { id: req.params.id } })
    if (!asset) {
      res.status(404).json({ success: false, message: 'Asset not found' })
      return
    }
    const updated = await db.templateCelebrityAsset.update({
      where: { id: req.params.id },
      data: { tts_model: ttsModel },
    })
    res.json({ success: true, data: updated })
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message })
  }
}

export async function deleteAsset(req: Request, res: Response): Promise<void> {
  try {
    const asset = await db.templateCelebrityAsset.findUnique({ where: { id: req.params.id } })
    if (!asset) {
      res.status(404).json({ success: false, message: 'Asset not found' })
      return
    }
    await db.templateCelebrityAsset.delete({ where: { id: req.params.id } })
    res.json({ success: true, message: 'Asset deleted' })
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message })
  }
}
