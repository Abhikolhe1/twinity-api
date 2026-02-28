import { Request, Response, NextFunction } from 'express'
import { Celebrity } from '../models/Celebrity'
import { AppError } from '../middleware/errorHandler'

export async function listCelebrities(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { industry, search, featured } = req.query
    const filter: Record<string, unknown> = { isActive: true }
    if (industry && industry !== 'all') filter.industry = industry
    if (featured === 'true') filter.isFeatured = true
    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: 'i' } },
        { nameAr: { $regex: search, $options: 'i' } },
      ]
    }
    const celebrities = await Celebrity.find(filter).sort({ isFeatured: -1, totalOrders: -1 })
    res.json({ success: true, data: celebrities, total: celebrities.length })
  } catch (err) {
    next(err)
  }
}

export async function getCelebrity(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const celeb = await Celebrity.findOne({ slug: req.params.slug, isActive: true })
    if (!celeb) throw new AppError('Celebrity not found', 404)
    res.json({ success: true, data: celeb })
  } catch (err) {
    next(err)
  }
}

// Admin only
export async function createCelebrity(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const celeb = await Celebrity.create(req.body)
    res.status(201).json({ success: true, data: celeb })
  } catch (err) {
    next(err)
  }
}

export async function updateCelebrity(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const celeb = await Celebrity.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true })
    if (!celeb) throw new AppError('Celebrity not found', 404)
    res.json({ success: true, data: celeb })
  } catch (err) {
    next(err)
  }
}

export async function toggleCelebrityStatus(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const celeb = await Celebrity.findById(req.params.id)
    if (!celeb) throw new AppError('Celebrity not found', 404)
    celeb.isActive = !celeb.isActive
    await celeb.save()
    res.json({ success: true, data: celeb, message: `Celebrity ${celeb.isActive ? 'activated' : 'deactivated'}` })
  } catch (err) {
    next(err)
  }
}

export async function deleteCelebrity(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const celeb = await Celebrity.findByIdAndDelete(req.params.id)
    if (!celeb) throw new AppError('Celebrity not found', 404)
    res.json({ success: true, message: 'Celebrity deleted' })
  } catch (err) {
    next(err)
  }
}
