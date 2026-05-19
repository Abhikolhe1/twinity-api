import { Request, Response, NextFunction } from 'express'
import prisma from '../lib/prisma'
import { AppError } from '../middleware/errorHandler'

// Public — list active product types (prompts excluded)
export async function listProductTypes(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const types = await prisma.productType.findMany({
      where: { isActive: true },
      orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
      select: {
        id: true, slug: true, name: true, nameAr: true,
        description: true, descriptionAr: true, detail: true, detailAr: true,
        icon: true, priceFrom: true, duration: true, durationAr: true,
        useCases: true, useCasesAr: true, isActive: true, order: true,
        createdAt: true, updatedAt: true,
        // videoPrompt and geminiSystemPrompt excluded
      },
    })
    res.json({ success: true, data: types, total: types.length })
  } catch (err) {
    next(err)
  }
}

// Admin — list all (including inactive, with prompts)
export async function adminListProductTypes(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const types = await prisma.productType.findMany({
      orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
    })
    res.json({ success: true, data: types, total: types.length })
  } catch (err) {
    next(err)
  }
}

// Admin — create
export async function createProductType(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = req.body
    const type = await prisma.productType.create({
      data: {
        slug:               body.slug,
        name:               body.name,
        nameAr:             body.nameAr,
        description:        body.description,
        descriptionAr:      body.descriptionAr,
        detail:             body.detail,
        detailAr:           body.detailAr,
        icon:               body.icon               || '',
        priceFrom:          body.priceFrom          ?? 0,
        duration:           body.duration           || '',
        durationAr:         body.durationAr         || '',
        useCases:           Array.isArray(body.useCases)   ? body.useCases   : [],
        useCasesAr:         Array.isArray(body.useCasesAr) ? body.useCasesAr : [],
        videoPrompt:        body.videoPrompt        || '',
        geminiSystemPrompt: body.geminiSystemPrompt || '',
        isActive:           body.isActive ?? true,
        order:              body.order    ?? 0,
      },
    })
    res.status(201).json({ success: true, data: type })
  } catch (err) {
    next(err)
  }
}

// Admin — update
export async function updateProductType(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const type = await prisma.productType.findUnique({ where: { id: req.params.id } })
    if (!type) throw new AppError('Product type not found', 404)

    const body = req.body
    const updateData: Record<string, unknown> = {}
    const fields = [
      'name','nameAr','description','descriptionAr','detail','detailAr',
      'icon','priceFrom','duration','durationAr','useCases','useCasesAr',
      'videoPrompt','geminiSystemPrompt','isActive','order',
    ]
    for (const f of fields) {
      if (f in body) updateData[f] = body[f]
    }

    const updated = await prisma.productType.update({ where: { id: req.params.id }, data: updateData })
    res.json({ success: true, data: updated })
  } catch (err) {
    next(err)
  }
}

// Admin — toggle active/inactive
export async function toggleProductType(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const type = await prisma.productType.findUnique({ where: { id: req.params.id } })
    if (!type) throw new AppError('Product type not found', 404)
    const updated = await prisma.productType.update({
      where: { id: req.params.id },
      data: { isActive: !type.isActive },
    })
    res.json({ success: true, data: updated })
  } catch (err) {
    next(err)
  }
}

// Admin — delete
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
