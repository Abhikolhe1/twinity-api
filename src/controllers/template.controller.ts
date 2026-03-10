import { Request, Response } from 'express'
import { Template } from '../models/Template'
import { AppError } from '../middleware/errorHandler'

// ── Public ───────────────────────────────────────────────────────────────────

export async function listTemplates(req: Request, res: Response): Promise<void> {
  try {
    const { productType } = req.query
    const filter: Record<string, unknown> = { isActive: true }
    if (productType && typeof productType === 'string') {
      filter.productTypes = productType
    }
    const templates = await Template.find(filter).sort({ purpose: 1 }).lean()
    res.json({ success: true, data: templates, total: templates.length })
  } catch {
    res.status(500).json({ success: false, message: 'Failed to fetch templates' })
  }
}

// ── Admin ────────────────────────────────────────────────────────────────────

export async function adminListTemplates(req: Request, res: Response): Promise<void> {
  try {
    const { search, productType, status } = req.query
    const filter: Record<string, unknown> = {}

    if (status === 'active')   filter.isActive = true
    if (status === 'inactive') filter.isActive = false
    if (productType && productType !== 'all') filter.productTypes = productType

    if (search && typeof search === 'string') {
      filter.$or = [
        { name:    { $regex: search, $options: 'i' } },
        { purpose: { $regex: search, $options: 'i' } },
      ]
    }

    const templates = await Template.find(filter).sort({ purpose: 1, name: 1 }).lean()
    res.json({ success: true, data: templates, total: templates.length })
  } catch {
    res.status(500).json({ success: false, message: 'Failed to fetch templates' })
  }
}

export async function createTemplate(req: Request, res: Response): Promise<void> {
  try {
    const template = await Template.create(req.body)
    res.status(201).json({ success: true, data: template })
  } catch (err: any) {
    res.status(400).json({ success: false, message: err.message || 'Failed to create template' })
  }
}

export async function updateTemplate(req: Request, res: Response): Promise<void> {
  try {
    const template = await Template.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true })
    if (!template) throw new AppError('Template not found', 404)
    res.json({ success: true, data: template })
  } catch (err: any) {
    if (err.statusCode) {
      res.status(err.statusCode).json({ success: false, message: err.message })
    } else {
      res.status(400).json({ success: false, message: err.message || 'Failed to update template' })
    }
  }
}

export async function toggleTemplateStatus(req: Request, res: Response): Promise<void> {
  try {
    const template = await Template.findById(req.params.id)
    if (!template) throw new AppError('Template not found', 404)
    template.isActive = !template.isActive
    await template.save()
    res.json({
      success: true,
      data: template,
      message: `Template ${template.isActive ? 'activated' : 'deactivated'}`,
    })
  } catch (err: any) {
    res.status(err.statusCode ?? 500).json({ success: false, message: err.message })
  }
}

export async function deleteTemplate(req: Request, res: Response): Promise<void> {
  try {
    const template = await Template.findByIdAndDelete(req.params.id)
    if (!template) throw new AppError('Template not found', 404)
    res.json({ success: true, message: 'Template deleted' })
  } catch (err: any) {
    res.status(err.statusCode ?? 500).json({ success: false, message: err.message })
  }
}
