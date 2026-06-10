import { Request, Response } from 'express'
import prisma from '../lib/prisma'
import { s3Service } from '../services/s3.service'
import { settingsService } from '../services/settings.service'

export async function listTemplates(req: Request, res: Response): Promise<void> {
  try {
    const { productType, language } = req.query
    const where: Record<string, unknown> = { is_active: true }
    if (productType && typeof productType === 'string') {
      where.product_types = { has: productType }
    }
    if (language && typeof language === 'string') {
      where.language = language
    }
    const templates = await (prisma.template as any).findMany({ where, orderBy: { purpose: 'asc' } })
    const data = await Promise.all(
      templates.map(async (template: any) => ({
        ...template,
        background_image_url: await s3Service.presignIfS3(template.background_image_url ?? undefined),
      })),
    )
    res.json({ success: true, data, total: data.length })
  } catch {
    res.status(500).json({ success: false, message: 'Failed to fetch templates' })
  }
}

export async function adminListTemplates(req: Request, res: Response): Promise<void> {
  try {
    const { search, productType, language, status } = req.query
    const where: Record<string, unknown> = {}

    if (status === 'active')   where.is_active = true
    if (status === 'inactive') where.is_active = false
    if (productType && productType !== 'all') where.product_types = { has: productType as string }
    if (language && language !== 'all') where.language = language as string

    if (search && typeof search === 'string') {
      where.OR = [
        { name:    { contains: search, mode: 'insensitive' } },
        { purpose: { contains: search, mode: 'insensitive' } },
      ]
    }

    const templates = await (prisma.template as any).findMany({ where, orderBy: [{ language: 'asc' }, { purpose: 'asc' }, { name: 'asc' }] })
    const data = await Promise.all(
      templates.map(async (template: any) => ({
        ...template,
        background_image_url: await s3Service.presignIfS3(template.background_image_url ?? undefined),
      })),
    )
    res.json({ success: true, data, total: data.length })
  } catch {
    res.status(500).json({ success: false, message: 'Failed to fetch templates' })
  }
}

export async function createTemplate(req: Request, res: Response): Promise<void> {
  try {
    const body = req.body
    const template = await (prisma.template as any).create({
      data: {
        name:             body.name,
        name_ar:          body.name_ar          ?? body.nameAr,
        description:      body.description,
        description_ar:   body.description_ar   ?? body.descriptionAr,
        purpose:          body.purpose,
        purpose_ar:       body.purpose_ar        ?? body.purposeAr,
        sample_script:    body.sample_script     ?? body.sampleScript,
        sample_script_ar: body.sample_script_ar  ?? body.sampleScriptAr,
        language:         body.language ?? 'en',
        background_image_url: body.background_image_url ?? body.backgroundImageUrl ?? undefined,
        creatify_prompt:  body.creatify_prompt ?? body.creatifyPrompt ?? undefined,
        video_generation_prompt: body.video_generation_prompt ?? body.videoGenerationPrompt ?? undefined,
        product_types:    Array.isArray(body.product_types ?? body.productTypes) ? (body.product_types ?? body.productTypes) : [],
        duration:         body.duration || '30s',
        is_active:        body.is_active ?? body.isActive ?? true,
      },
    })
    const data = { ...template, background_image_url: await s3Service.presignIfS3((template as any).background_image_url ?? undefined) }
    res.status(201).json({ success: true, data })
  } catch (err: any) {
    res.status(400).json({ success: false, message: err.message || 'Failed to create template' })
  }
}

export async function updateTemplate(req: Request, res: Response): Promise<void> {
  try {
    const template = await prisma.template.findUnique({ where: { id: req.params.id } })
    if (!template) {
      res.status(404).json({ success: false, message: 'Template not found' })
      return
    }
    const body = req.body
    const updateData: Record<string, unknown> = {}
    const fieldMap: Record<string, string> = {
      name: 'name', nameAr: 'name_ar', name_ar: 'name_ar',
      description: 'description', descriptionAr: 'description_ar', description_ar: 'description_ar',
      purpose: 'purpose', purposeAr: 'purpose_ar', purpose_ar: 'purpose_ar',
      sampleScript: 'sample_script', sample_script: 'sample_script',
      sampleScriptAr: 'sample_script_ar', sample_script_ar: 'sample_script_ar',
      language: 'language',
      backgroundImageUrl: 'background_image_url', background_image_url: 'background_image_url',
      creatifyPrompt: 'creatify_prompt', creatify_prompt: 'creatify_prompt',
      videoGenerationPrompt: 'video_generation_prompt', video_generation_prompt: 'video_generation_prompt',
      productTypes: 'product_types', product_types: 'product_types',
      duration: 'duration',
      isActive: 'is_active', is_active: 'is_active',
    }
    for (const [key, dbKey] of Object.entries(fieldMap)) {
      if (key in body) updateData[dbKey] = body[key]
    }
    const updated = await (prisma.template as any).update({ where: { id: req.params.id }, data: updateData })
    const data = { ...updated, background_image_url: await s3Service.presignIfS3((updated as any).background_image_url ?? undefined) }
    res.json({ success: true, data })
  } catch (err: any) {
    res.status(400).json({ success: false, message: err.message || 'Failed to update template' })
  }
}

export async function toggleTemplateStatus(req: Request, res: Response): Promise<void> {
  try {
    const template = await prisma.template.findUnique({ where: { id: req.params.id } })
    if (!template) {
      res.status(404).json({ success: false, message: 'Template not found' })
      return
    }
    const updated = await prisma.template.update({
      where: { id: req.params.id },
      data: { is_active: !template.is_active },
    })
    res.json({
      success: true,
      data: updated,
      message: `Template ${updated.is_active ? 'activated' : 'deactivated'}`,
    })
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message })
  }
}

export async function uploadTemplateImage(req: Request, res: Response): Promise<void> {
  try {
    const file = (req as Request & { file?: Express.Multer.File }).file
    if (!file) {
      res.status(400).json({ success: false, message: 'No image file provided' })
      return
    }

    const { s3Bucket } = await settingsService.get()
    const ext = file.originalname.split('.').pop()?.toLowerCase() || 'png'
    const key = `template-images/${Date.now()}.${ext}`
    const result = await s3Service.upload(s3Bucket, key, file.buffer, file.mimetype)

    res.json({ success: true, url: result.url })
  } catch {
    res.status(500).json({ success: false, message: 'Failed to upload image' })
  }
}

export async function deleteTemplate(req: Request, res: Response): Promise<void> {
  try {
    const template = await prisma.template.findUnique({ where: { id: req.params.id } })
    if (!template) {
      res.status(404).json({ success: false, message: 'Template not found' })
      return
    }
    await prisma.template.delete({ where: { id: req.params.id } })
    res.json({ success: true, message: 'Template deleted' })
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message })
  }
}
