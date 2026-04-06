import { Request, Response, NextFunction } from 'express'
import { ProductType } from '../models/ProductType'
import { AppError } from '../middleware/errorHandler'

// Public — list active product types (prompts excluded)
export async function listProductTypes(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const types = await ProductType.find({ isActive: true })
      .sort({ order: 1, createdAt: 1 })
      .select('-positivePrompt -negativePrompt -geminiSystemPrompt')
      .lean()
    res.json({ success: true, data: types, total: types.length })
  } catch (err) {
    next(err)
  }
}

// Admin — list all (including inactive, with prompts)
export async function adminListProductTypes(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const types = await ProductType.find().sort({ order: 1, createdAt: 1 }).lean()
    res.json({ success: true, data: types, total: types.length })
  } catch (err) {
    next(err)
  }
}

// Admin — create
export async function createProductType(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const type = await ProductType.create(req.body)
    res.status(201).json({ success: true, data: type })
  } catch (err) {
    next(err)
  }
}

// Admin — update
export async function updateProductType(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const type = await ProductType.findByIdAndUpdate(
      req.params.id,
      { $set: req.body },
      { new: true, runValidators: true },
    )
    if (!type) throw new AppError('Product type not found', 404)
    res.json({ success: true, data: type })
  } catch (err) {
    next(err)
  }
}

// Admin — toggle active/inactive
export async function toggleProductType(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const type = await ProductType.findById(req.params.id)
    if (!type) throw new AppError('Product type not found', 404)
    type.isActive = !type.isActive
    await type.save()
    res.json({ success: true, data: type })
  } catch (err) {
    next(err)
  }
}

// Admin — delete
export async function deleteProductType(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const type = await ProductType.findByIdAndDelete(req.params.id)
    if (!type) throw new AppError('Product type not found', 404)
    res.json({ success: true, message: 'Product type deleted' })
  } catch (err) {
    next(err)
  }
}
