import { Request, Response } from 'express'
import { Template } from '../models/Template'

export async function listTemplates(req: Request, res: Response): Promise<void> {
  try {
    const { productType } = req.query

    const filter: Record<string, unknown> = { isActive: true }
    if (productType && typeof productType === 'string') {
      filter.productTypes = productType
    }

    const templates = await Template.find(filter).sort({ purpose: 1 }).lean()

    res.json({ success: true, data: templates, total: templates.length })
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to fetch templates' })
  }
}
