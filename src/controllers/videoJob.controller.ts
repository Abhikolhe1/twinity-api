import { Request, Response, NextFunction } from 'express'
import mongoose from 'mongoose'
import { VideoJob, VideoJobStatus } from '../models/VideoJob'
import { Celebrity } from '../models/Celebrity'
import { User } from '../models/User'
import { Lead } from '../models/Lead'
import { AppError } from '../middleware/errorHandler'
import { queueService } from '../services/queue.service'
import { emailService } from '../services/email.service'
import { s3Service } from '../services/s3.service'
import { aiService } from '../services/ai.service'
import { settingsService } from '../services/settings.service'
import { Settings } from '../models/Settings'
import { ProductType } from '../models/ProductType'
import { AuthRequest } from '../middleware/auth'

async function signJobThumbnail(job: Record<string, unknown>): Promise<Record<string, unknown>> {
  const celeb = job.celebrityId as Record<string, unknown> | undefined
  if (!celeb?.thumbnailUrl) return job
  return {
    ...job,
    celebrityId: { ...celeb, thumbnailUrl: await s3Service.presignIfS3(celeb.thumbnailUrl as string) },
  }
}

function generateRef(): string {
  const now = new Date()
  const year = now.getFullYear()
  const seq = Math.floor(Math.random() * 9000) + 1000
  return `TWN-${year}-${seq}`
}

export async function createJob(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { celebrityId, productType, purpose, templateId, script, tone, duration, aspectRatio, resolution, channels,
            propImages, sceneNotes, backgroundImageUrl } = req.body

    const celeb = await Celebrity.findById(celebrityId)
    if (!celeb || !celeb.isActive) throw new AppError('Celebrity not found or inactive', 404)

    // Check script against blocked words via DB aggregation (scales to large word lists)
    if (script) {
      const agg = await Settings.aggregate([
        { $match: { key: 'global' } },
        {
          $project: {
            found: {
              $filter: {
                input: '$blockedWords',
                as: 'word',
                cond: {
                  $regexMatch: {
                    input: script.toLowerCase(),
                    regex: { $concat: ['\\b', { $toLower: '$$word' }, '\\b'] },
                  },
                },
              },
            },
          },
        },
      ])
      const found: string[] = agg[0]?.found ?? []
      if (found.length > 0) throw new AppError(`Script contains prohibited content: ${found.join(', ')}`, 422)
    }

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
      propImages:         Array.isArray(propImages) && propImages.length ? propImages : undefined,
      sceneNotes:         sceneNotes         || undefined,
      backgroundImageUrl: backgroundImageUrl || undefined,
    })

    // Increment celebrity order count
    await Celebrity.findByIdAndUpdate(celebrityId, { $inc: { totalOrders: 1 } })

    // Dispatch to queue (non-blocking)
    await queueService.dispatchVideoJob(String(job._id))

    res.status(201).json({ success: true, data: job })
  } catch (err) {
    next(err)
  }
}

export async function getMyStats(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const counts = await VideoJob.aggregate([
      { $match: { userId: new mongoose.Types.ObjectId(req.userId) } },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ])
    const stats: Record<string, number> = { all: 0, pending: 0, 'in-progress': 0, review: 0, delivered: 0, cancelled: 0, failed: 0 }
    for (const row of counts) {
      const s = row._id as string
      if (s in stats) stats[s] = row.count
      stats.all += row.count
    }
    res.json({ success: true, data: stats })
  } catch (err) {
    next(err)
  }
}

export async function getMyJobs(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { status, page = '1', limit = '12' } = req.query
    const filter: Record<string, unknown> = { userId: req.userId }
    if (status && status !== 'all') filter.status = status

    const pageNum  = Math.max(1, parseInt(page  as string, 10) || 1)
    const limitNum = Math.min(50, Math.max(1, parseInt(limit as string, 10) || 12))
    const skip     = (pageNum - 1) * limitNum

    const [raw, total] = await Promise.all([
      VideoJob.find(filter)
        .populate('celebrityId', 'name nameAr initials avatarColor thumbnailUrl')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .lean(),
      VideoJob.countDocuments(filter),
    ])

    const data = await Promise.all(raw.map(j => signJobThumbnail(j as Record<string, unknown>)))
    res.json({ success: true, data, total, page: pageNum, pages: Math.ceil(total / limitNum), hasMore: skip + data.length < total })
  } catch (err) {
    next(err)
  }
}

export async function getJob(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const raw = await VideoJob.findOne({ referenceId: req.params.referenceId, userId: req.userId })
      .populate('celebrityId', 'name nameAr initials avatarColor thumbnailUrl')
      .lean()
    if (!raw) throw new AppError('Job not found', 404)
    res.json({ success: true, data: await signJobThumbnail(raw as Record<string, unknown>) })
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

export async function cancelJob(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const job = await VideoJob.findOne({ referenceId: req.params.referenceId, userId: req.userId })
    if (!job) throw new AppError('Job not found', 404)
    if (job.status !== 'pending') throw new AppError('Only pending jobs can be cancelled', 400)

    job.status = 'cancelled'
    job.statusHistory.push({ status: 'cancelled', timestamp: new Date(), note: 'Cancelled by customer' })
    await job.save()

    res.json({ success: true, data: job })
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

// Admin — CS approves a job in 'review' status → delivered + notify customer
export async function adminApproveJob(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const job = await VideoJob.findById(req.params.id)
    if (!job) throw new AppError('Job not found', 404)
    if (job.status !== 'review') throw new AppError('Job must be in review status to approve', 400)

    job.status = 'delivered'
    job.downloadEnabled = true
    job.deliveredAt = new Date()
    job.statusHistory.push({ status: 'delivered', timestamp: new Date(), note: 'Approved by CS team' })
    await job.save()

    User.findById(job.userId).then(user => {
      if (user) emailService.sendJobStatusUpdate(user.email, user.name, 'delivered', job.referenceId).catch(() => null)
    }).catch(() => null)

    res.json({ success: true, data: job, message: 'Job approved and delivered to customer' })
  } catch (err) {
    next(err)
  }
}

// Admin — CS rejects a job in 'review' status → failed
export async function adminRejectJob(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { note } = req.body as { note?: string }
    const job = await VideoJob.findById(req.params.id)
    if (!job) throw new AppError('Job not found', 404)
    if (job.status !== 'review') throw new AppError('Job must be in review status to reject', 400)

    job.status = 'failed'
    job.errorMessage = note || 'Rejected by CS team'
    job.statusHistory.push({ status: 'failed', timestamp: new Date(), note: job.errorMessage })
    await job.save()

    User.findById(job.userId).then(user => {
      if (user) emailService.sendJobStatusUpdate(user.email, user.name, 'failed', job.referenceId).catch(() => null)
    }).catch(() => null)

    res.json({ success: true, data: job, message: 'Job rejected' })
  } catch (err) {
    next(err)
  }
}

// Authenticated — generate scene prompt suggestions with AI
export async function suggestScenePrompts(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { celebrityName, productType, purpose, script } = req.body as {
      celebrityName: string; productType: string; purpose?: string; script?: string
    }
    if (!celebrityName?.trim()) throw new AppError('celebrityName is required', 400)
    if (!productType?.trim()) throw new AppError('productType is required', 400)

    const suggestions = await aiService.generateScenePrompts({ celebrityName, productType, purpose, script })
    res.json({ success: true, suggestions })
  } catch (err) {
    next(err)
  }
}

// Authenticated — improve script with AI
export async function improveScript(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { script, celebrityName, productType, purpose } = req.body as {
      script: string; celebrityName: string; productType: string; purpose?: string
    }
    if (!script?.trim()) throw new AppError('script is required', 400)
    if (!celebrityName?.trim()) throw new AppError('celebrityName is required', 400)
    if (!productType?.trim()) throw new AppError('productType is required', 400)

    const improved = await aiService.improveScript({ script, celebrityName, productType, purpose })
    res.json({ success: true, improvedScript: improved })
  } catch (err) {
    next(err)
  }
}

// Authenticated — generate image with Gemini
export async function generateImage(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { prompt, chatHistory, productTypeSlug, celebrityImageUrl, propImages } = req.body as {
      prompt: string
      chatHistory?: Array<{ role: 'user' | 'model'; text: string; imageUrl?: string }>
      productTypeSlug?: string
      celebrityImageUrl?: string
      propImages?: string[]   // base64 data URLs
    }
    if (!prompt?.trim()) throw new AppError('prompt is required', 400)

    const settings = await settingsService.get()
    if (!settings.geminiApiKey) {
      throw new AppError('Gemini API key not configured. Please add it in Admin > Settings.', 503)
    }

    // Load product-type Gemini system prompt from DB when provided
    let geminiSystemPrompt: string | undefined
    if (productTypeSlug) {
      const pt = await ProductType.findOne({ slug: productTypeSlug }).lean()
      if (pt?.geminiSystemPrompt?.trim()) {
        geminiSystemPrompt = pt.geminiSystemPrompt
      }
    }

    // Build conversation contents for Gemini
    type GeminiPart = { text?: string; inlineData?: { mimeType: string; data: string } }
    const contents: Array<{ role: string; parts: GeminiPart[] }> = []

    // Helper: fetch a URL (S3 presigned or external) and convert to base64 inline part
    async function urlToInlinePart(url: string): Promise<GeminiPart | null> {
      try {
        const imgRes = await fetch(url)
        if (!imgRes.ok) return null
        const mimeType = imgRes.headers.get('content-type') || 'image/jpeg'
        const buf = await imgRes.arrayBuffer()
        return { inlineData: { mimeType, data: Buffer.from(buf).toString('base64') } }
      } catch { return null }
    }

    if (chatHistory?.length) {
      for (const msg of chatHistory) {
        if (msg.role === 'user') {
          contents.push({ role: 'user', parts: [{ text: msg.text }] })
        } else if (msg.role === 'model' && msg.imageUrl) {
          // Re-send previous image as inline data for Gemini context
          // Supports both data URLs (legacy) and S3 presigned URLs (current)
          let part: GeminiPart | null = null
          if (msg.imageUrl.startsWith('data:image/')) {
            const base64Match = msg.imageUrl.match(/^data:image\/(.*?);base64,(.+)$/)
            if (base64Match) part = { inlineData: { mimeType: `image/${base64Match[1]}`, data: base64Match[2] } }
          } else if (msg.imageUrl.startsWith('https://')) {
            part = await urlToInlinePart(msg.imageUrl)
          }
          if (part) contents.push({ role: 'model', parts: [part] })
        }
      }
    }

    // Build the current user message — reference images come first, then the text prompt
    const currentParts: GeminiPart[] = []

    // Celebrity thumbnail: fetch from presigned S3 URL and inline as base64
    if (celebrityImageUrl?.trim()) {
      const part = await urlToInlinePart(celebrityImageUrl)
      if (part) currentParts.push(part)
    }

    // Prop / item reference images — now S3 presigned URLs uploaded via /upload-asset
    // Also accept legacy base64 data URLs for backwards compatibility
    for (const imgUrl of propImages ?? []) {
      if (imgUrl.startsWith('data:image/')) {
        const match = imgUrl.match(/^data:(image\/[^;]+);base64,(.+)$/)
        if (match) currentParts.push({ inlineData: { mimeType: match[1], data: match[2] } })
      } else if (imgUrl.startsWith('https://')) {
        const part = await urlToInlinePart(imgUrl)
        if (part) currentParts.push(part)
      }
    }

    currentParts.push({ text: prompt })
    contents.push({ role: 'user', parts: currentParts })

    const requestBody: Record<string, unknown> = {
      contents,
      generationConfig: { responseModalities: ['IMAGE', 'TEXT'] },
    }
    if (geminiSystemPrompt) {
      requestBody.systemInstruction = {
        role: 'system',
        parts: [{ text: geminiSystemPrompt }],
      }
    }

    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro-image-preview:generateContent?key=${settings.geminiApiKey}`,
      {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      },
    )

    if (!geminiRes.ok) {
      const errText = await geminiRes.text()
      throw new AppError(`Gemini API error (${geminiRes.status}): ${errText}`, 502)
    }

    const geminiData = await geminiRes.json() as {
      candidates?: Array<{
        content?: {
          parts?: Array<{
            text?: string
            inlineData?: { mimeType: string; data: string }
          }>
        }
      }>
    }

    const parts = geminiData.candidates?.[0]?.content?.parts ?? []
    const imagePart = parts.find(p => p.inlineData)
    if (!imagePart?.inlineData) throw new AppError('Gemini returned no image', 502)

    // Upload generated image to S3 so Creatify can access it via HTTPS
    const imgBuffer  = Buffer.from(imagePart.inlineData.data, 'base64')
    const imgMime    = imagePart.inlineData.mimeType          // e.g. image/png
    const imgExt     = imgMime.split('/')[1] || 'png'
    const userId     = req.userId ?? 'anon'
    const imgKey     = `generated-images/${userId}/${Date.now()}.${imgExt}`
    const { s3Bucket } = await settingsService.get()
    const upload = await s3Service.upload(s3Bucket, imgKey, imgBuffer, imgMime)

    // Return presigned URL (or stub URL if no S3 configured)
    const imageUrl = upload.stub
      ? upload.url
      : await s3Service.getPresignedUrl(s3Bucket, upload.key, 86_400)

    const textPart = parts.find(p => p.text)
    res.json({ success: true, imageUrl, revisedPrompt: textPart?.text })
  } catch (err) {
    next(err)
  }
}

// Authenticated — upload a user asset (prop/reference image) to S3
export async function uploadAsset(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { dataUrl } = req.body as { dataUrl?: string }
    if (!dataUrl?.trim()) throw new AppError('dataUrl is required', 400)

    const match = dataUrl.match(/^data:(image\/[^;]+);base64,(.+)$/)
    if (!match) throw new AppError('dataUrl must be a valid base64 image data URL', 400)

    const mimeType = match[1]
    const ext      = mimeType.split('/')[1] || 'png'
    const buffer   = Buffer.from(match[2], 'base64')
    const userId   = req.userId ?? 'anon'
    const key      = `user-assets/${userId}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`

    const { s3Bucket } = await settingsService.get()
    const upload = await s3Service.upload(s3Bucket, key, buffer, mimeType)

    const url = upload.stub
      ? upload.url
      : await s3Service.getPresignedUrl(s3Bucket, upload.key, 86_400)

    res.json({ success: true, url })
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
