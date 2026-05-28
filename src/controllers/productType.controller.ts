import { Request, Response, NextFunction } from 'express'
import prisma from '../lib/prisma'
import { AppError } from '../middleware/errorHandler'

export async function listProductTypes(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const types = await prisma.productType.findMany({
      where: { is_active: true },
      orderBy: [{ order: 'asc' }, { created_at: 'asc' }],
      select: {
        id: true, slug: true, name: true, name_ar: true,
        description: true, description_ar: true, detail: true, detail_ar: true,
        icon: true, price_from: true, duration: true, duration_ar: true,
        use_cases: true, use_cases_ar: true, is_active: true, order: true,
        created_at: true, updated_at: true,
      },
    })
    res.json({ success: true, data: types, total: types.length })
  } catch (err) {
    next(err)
  }
}

export async function adminListProductTypes(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const types = await prisma.productType.findMany({
      orderBy: [{ order: 'asc' }, { created_at: 'asc' }],
    })
    res.json({ success: true, data: types, total: types.length })
  } catch (err) {
    next(err)
  }
}

export async function createProductType(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = req.body
    const type = await prisma.productType.create({
      data: {
        slug:                 body.slug,
        name:                 body.name,
        name_ar:              body.name_ar              ?? body.nameAr,
        description:          body.description,
        description_ar:       body.description_ar       ?? body.descriptionAr,
        detail:               body.detail,
        detail_ar:            body.detail_ar            ?? body.detailAr,
        icon:                 body.icon                 || '',
        price_from:           body.price_from           ?? body.priceFrom ?? 0,
        duration:             body.duration             || '',
        duration_ar:          body.duration_ar          ?? body.durationAr ?? '',
        use_cases:            Array.isArray(body.use_cases   ?? body.useCases)   ? (body.use_cases   ?? body.useCases)   : [],
        use_cases_ar:         Array.isArray(body.use_cases_ar ?? body.useCasesAr) ? (body.use_cases_ar ?? body.useCasesAr) : [],
        video_prompt:         body.video_prompt         ?? body.videoPrompt        ?? '',
        gemini_system_prompt: body.gemini_system_prompt ?? body.geminiSystemPrompt ?? '',
        is_active:            body.is_active            ?? body.isActive ?? true,
        order:                body.order                ?? 0,
      },
    })
    res.status(201).json({ success: true, data: type })
  } catch (err) {
    next(err)
  }
}

export async function updateProductType(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const type = await prisma.productType.findUnique({ where: { id: req.params.id } })
    if (!type) throw new AppError('Product type not found', 404)

    const body = req.body
    const updateData: Record<string, unknown> = {}
    const fieldMap: Record<string, string> = {
      name: 'name', nameAr: 'name_ar', name_ar: 'name_ar',
      description: 'description', descriptionAr: 'description_ar', description_ar: 'description_ar',
      detail: 'detail', detailAr: 'detail_ar', detail_ar: 'detail_ar',
      icon: 'icon',
      priceFrom: 'price_from', price_from: 'price_from',
      duration: 'duration',
      durationAr: 'duration_ar', duration_ar: 'duration_ar',
      useCases: 'use_cases', use_cases: 'use_cases',
      useCasesAr: 'use_cases_ar', use_cases_ar: 'use_cases_ar',
      videoPrompt: 'video_prompt', video_prompt: 'video_prompt',
      geminiSystemPrompt: 'gemini_system_prompt', gemini_system_prompt: 'gemini_system_prompt',
      isActive: 'is_active', is_active: 'is_active',
      order: 'order',
    }
    for (const [key, dbKey] of Object.entries(fieldMap)) {
      if (key in body) updateData[dbKey] = body[key]
    }

    const updated = await prisma.productType.update({ where: { id: req.params.id }, data: updateData })
    res.json({ success: true, data: updated })
  } catch (err) {
    next(err)
  }
}

export async function toggleProductType(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const type = await prisma.productType.findUnique({ where: { id: req.params.id } })
    if (!type) throw new AppError('Product type not found', 404)
    const updated = await prisma.productType.update({
      where: { id: req.params.id },
      data: { is_active: !type.is_active },
    })
    res.json({ success: true, data: updated })
  } catch (err) {
    next(err)
  }
}

export async function deleteProductType(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const type = await prisma.productType.findUnique({ where: { id: req.params.id } })
    if (!type) throw new AppError('Product type not found', 404)
    await prisma.productType.delete({ where: { id: req.params.id } })
    res.json({ success: true, message: 'Product type deleted' })
  } catch (err) {
    next(err)
  }
}
