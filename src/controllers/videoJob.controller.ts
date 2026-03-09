import { Request, Response, NextFunction } from 'express'
import { VideoJob, VideoJobStatus } from '../models/VideoJob'
import { Celebrity } from '../models/Celebrity'
import { User } from '../models/User'
import { Lead } from '../models/Lead'
import { AppError } from '../middleware/errorHandler'
import { queueService } from '../services/queue.service'
import { emailService } from '../services/email.service'
import { AuthRequest } from '../middleware/auth'

function generateRef(): string {
  const now = new Date()
  const year = now.getFullYear()
  const seq = Math.floor(Math.random() * 9000) + 1000
  return `TWN-${year}-${seq}`
}

export async function createJob(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { celebrityId, productType, purpose, templateId, script, tone, duration, aspectRatio, resolution, channels } = req.body

    const celeb = await Celebrity.findById(celebrityId)
    if (!celeb || !celeb.isActive) throw new AppError('Celebrity not found or inactive', 404)

    // Estimate price based on product type range
    const range = celeb.priceRange[productType as keyof typeof celeb.priceRange]
    const estimatedPrice = range ? Math.floor((range.min + range.max) / 2) : 0

    const job = await VideoJob.create({
      referenceId: generateRef(),
      userId: req.userId,
      celebrityId,
      productType,
      purpose,
      templateId,
      script,
      tone,
      duration: duration || '30s',
      aspectRatio: aspectRatio || '16:9',
      resolution: resolution || '1080p',
      channels: channels || [],
      estimatedPrice,
      statusHistory: [{ status: 'pending', timestamp: new Date() }],
    })

    // Increment celebrity order count
    await Celebrity.findByIdAndUpdate(celebrityId, { $inc: { totalOrders: 1 } })

    // Dispatch to queue (non-blocking)
    queueService.dispatchVideoJob(String(job._id)).catch(() => null)

    res.status(201).json({ success: true, data: job })
  } catch (err) {
    next(err)
  }
}

export async function getMyJobs(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { status } = req.query
    const filter: Record<string, unknown> = { userId: req.userId }
    if (status && status !== 'all') filter.status = status

    const jobs = await VideoJob.find(filter)
      .populate('celebrityId', 'name nameAr initials avatarColor thumbnailUrl')
      .sort({ createdAt: -1 })

    res.json({ success: true, data: jobs, total: jobs.length })
  } catch (err) {
    next(err)
  }
}

export async function getJob(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const job = await VideoJob.findOne({ referenceId: req.params.referenceId, userId: req.userId })
      .populate('celebrityId', 'name nameAr initials avatarColor thumbnailUrl')
    if (!job) throw new AppError('Job not found', 404)
    res.json({ success: true, data: job })
  } catch (err) {
    next(err)
  }
}

export async function submitBookCall(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { referenceId } = req.params
    const { name, email, phone, company, notes } = req.body

    const job = await VideoJob.findOne({ referenceId, userId: req.userId })
      .populate<{ celebrityId: { name: string; productType: string } }>('celebrityId', 'name')
    if (!job) throw new AppError('Job not found', 404)

    const celeb = job.celebrityId as unknown as { name: string }

    // Create lead
    const lead = await Lead.create({
      userId: req.userId,
      videoJobId: job._id,
      name, email, phone, company, notes,
      celebrityName: celeb.name,
      productType: job.productType,
      purpose: job.purpose,
      estimatedValue: job.estimatedPrice,
      currency: job.currency,
      source: 'book-call',
      statusHistory: [{ status: 'new', timestamp: new Date() }],
    })

    // Notify admin (non-blocking)
    emailService.sendNewLeadNotification(lead).catch(() => null)

    res.status(201).json({ success: true, data: lead, message: 'Sales inquiry submitted successfully' })
  } catch (err) {
    next(err)
  }
}

// Admin — list all jobs
export async function adminListJobs(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { status, userId, page = 1, limit = 20 } = req.query
    const filter: Record<string, unknown> = {}
    if (status) filter.status = status
    if (userId) filter.userId = userId

    const skip = (Number(page) - 1) * Number(limit)
    const [jobs, total] = await Promise.all([
      VideoJob.find(filter)
        .populate('userId', 'name email')
        .populate('celebrityId', 'name initials')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Number(limit)),
      VideoJob.countDocuments(filter),
    ])

    res.json({ success: true, data: jobs, total, page: Number(page), pages: Math.ceil(total / Number(limit)) })
  } catch (err) {
    next(err)
  }
}

// Admin — update job status
export async function adminUpdateJobStatus(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { id } = req.params
    const { status, note } = req.body as { status: VideoJobStatus; note?: string }

    const job = await VideoJob.findById(id)
    if (!job) throw new AppError('Job not found', 404)

    job.status = status
    job.statusHistory.push({ status, timestamp: new Date(), note })
    if (status === 'delivered') {
      job.deliveredAt = new Date()
      job.downloadEnabled = true
    }
    await job.save()

    // Notify user of status change (non-blocking)
    User.findById(job.userId).then(user => {
      if (user) emailService.sendJobStatusUpdate(user.email, user.name, status, job.referenceId).catch(() => null)
    }).catch(() => null)

    res.json({ success: true, data: job })
  } catch (err) {
    next(err)
  }
}

// Admin — enable download
export async function adminEnableDownload(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const job = await VideoJob.findByIdAndUpdate(
      req.params.id,
      { downloadEnabled: true },
      { new: true }
    )
    if (!job) throw new AppError('Job not found', 404)
    res.json({ success: true, data: job, message: 'Download enabled' })
  } catch (err) {
    next(err)
  }
}
