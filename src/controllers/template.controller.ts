import { Request, Response } from 'express'
import prisma from '../lib/prisma'
import { AppError } from '../middleware/errorHandler'

// ── Public ───────────────────────────────────────────────────────────────────

export async function listTemplates(req: Request, res: Response): Promise<void> {
  try {
    const { productType } = req.query
    const where: Record<string, unknown> = { isActive: true }
    if (productType && typeof productType === 'string') {
      where.productTypes = { has: productType }
    }
    const templates = await prisma.template.findMany({ where, orderBy: { purpose: 'asc' } })
    res.json({ success: true, data: templates, total: templates.length })
  } catch {
    res.status(500).json({ success: false, message: 'Failed to fetch templates' })
  }
}

// ── Admin ────────────────────────────────────────────────────────────────────

export async function adminListTemplates(req: Request, res: Response): Promise<void> {
  try {
    const { search, productType, status } = req.query
    const where: Record<string, unknown> = {}

    if (status === 'active')   where.isActive = true
    if (status === 'inactive') where.isActive = false
    if (productType && productType !== 'all') where.productTypes = { has: productType as string }

    if (search && typeof search === 'string') {
      where.OR = [
        { name:    { contains: search, mode: 'insensitive' } },
        { purpose: { contains: search, mode: 'insensitive' } },
      ]
    }

    const templates = await prisma.template.findMany({ where, orderBy: [{ purpose: 'asc' }, { name: 'asc' }] })
    res.json({ success: true, data: templates, total: templates.length })
  } catch {
    res.status(500).json({ success: false, message: 'Failed to fetch templates' })
  }
}

export async function createTemplate(req: Request, res: Response): Promise<void> {
  try {
    const body = req.body
    const template = await prisma.template.create({
      data: {
        name:           body.name,
        nameAr:         body.nameAr,
        description:    body.description,
        descriptionAr:  body.descriptionAr,
        purpose:        body.purpose,
        purposeAr:      body.purposeAr,
        sampleScript:   body.sampleScript,
        sampleScriptAr: body.sampleScriptAr,
        productTypes:   Array.isArray(body.productTypes) ? body.productTypes : [],
        duration:       body.duration || '30s',
        isActive:       body.isActive ?? true,
      },
    })
    res.status(201).json({ success: true, data: template })
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
    const fields = ['name','nameAr','description','descriptionAr','purpose','purposeAr',
                    'sampleScript','sampleScriptAr','productTypes','duration','isActive']
    for (const f of fields) {
      if (f in body) updateData[f] = body[f]
    }
    const updated = await prisma.template.update({ where: { id: req.params.id }, data: updateData })
    res.json({ success: true, data: updated })
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
      data: { isActive: !template.isActive },
    })
    res.json({
      success: true,
      data: updated,
      message: `Template ${updated.isActive ? 'activated' : 'deactivated'}`,
    })
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message })
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
