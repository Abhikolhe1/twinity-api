import { Request, Response } from 'express'
import prisma from '../lib/prisma'

export async function listTemplates(req: Request, res: Response): Promise<void> {
  try {
    const { productType } = req.query
    const where: Record<string, unknown> = { is_active: true }
    if (productType && typeof productType === 'string') {
      where.product_types = { has: productType }
    }
    const templates = await prisma.template.findMany({ where, orderBy: { purpose: 'asc' } })
    res.json({ success: true, data: templates, total: templates.length })
  } catch {
    res.status(500).json({ success: false, message: 'Failed to fetch templates' })
  }
}

export async function adminListTemplates(req: Request, res: Response): Promise<void> {
  try {
    const { search, productType, status } = req.query
    const where: Record<string, unknown> = {}

    if (status === 'active')   where.is_active = true
    if (status === 'inactive') where.is_active = false
    if (productType && productType !== 'all') where.product_types = { has: productType as string }

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
        name:             body.name,
        name_ar:          body.name_ar          ?? body.nameAr,
        description:      body.description,
        description_ar:   body.description_ar   ?? body.descriptionAr,
        purpose:          body.purpose,
        purpose_ar:       body.purpose_ar        ?? body.purposeAr,
        sample_script:    body.sample_script     ?? body.sampleScript,
        sample_script_ar: body.sample_script_ar  ?? body.sampleScriptAr,
        product_types:    Array.isArray(body.product_types ?? body.productTypes) ? (body.product_types ?? body.productTypes) : [],
        duration:         body.duration || '30s',
        is_active:        body.is_active ?? body.isActive ?? true,
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
    const fieldMap: Record<string, string> = {
      name: 'name', nameAr: 'name_ar', name_ar: 'name_ar',
      description: 'description', descriptionAr: 'description_ar', description_ar: 'description_ar',
      purpose: 'purpose', purposeAr: 'purpose_ar', purpose_ar: 'purpose_ar',
      sampleScript: 'sample_script', sample_script: 'sample_script',
      sampleScriptAr: 'sample_script_ar', sample_script_ar: 'sample_script_ar',
      productTypes: 'product_types', product_types: 'product_types',
      duration: 'duration',
      isActive: 'is_active', is_active: 'is_active',
    }
    for (const [key, dbKey] of Object.entries(fieldMap)) {
      if (key in body) updateData[dbKey] = body[key]
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
