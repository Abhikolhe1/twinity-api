import { Request, Response, NextFunction } from 'express'
import prisma from '../lib/prisma'
import { AppError } from '../middleware/errorHandler'
import { queueService } from '../services/queue.service'
import { emailService } from '../services/email.service'
import { s3Service } from '../services/s3.service'
import { aiService, ElevenLabsTTSModel, ElevenLabsSTSModel } from '../services/ai.service'
import { settingsService } from '../services/settings.service'
import { AuthRequest } from '../middleware/auth'
import type { VideoJobStatus } from '../models/types'

async function signJobThumbnail(job: Record<string, unknown>): Promise<Record<string, unknown>> {
  const celeb = job.celebrity as Record<string, unknown> | undefined
  if (!celeb?.thumbnailUrl) return job
  return {
    ...job,
    celebrity: { ...celeb, thumbnailUrl: await s3Service.presignIfS3(celeb.thumbnailUrl as string) },
  }
}

function generateRef(): string {
  const now = new Date()
  const year = now.getFullYear()
  const seq = Math.floor(Math.random() * 9000) + 1000
  return `TWN-${year}-${seq}`
}

// Helper: append entry to a Json statusHistory array (fetch-then-update pattern)
async function appendStatusHistory(
  jobId: string,
  entry: { status: string; timestamp: string; note?: string }
): Promise<unknown> {
  const job = await prisma.videoJob.findUnique({ where: { id: jobId }, select: { statusHistory: true } })
  const history = (Array.isArray(job?.statusHistory) ? job!.statusHistory : []) as unknown[]
  return [...history, entry]
}

export async function createJob(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { celebrityId, productType, purpose, templateId, script, tone, duration, aspectRatio, resolution, channels,
            propImages, sceneNotes, backgroundImageUrl,
            voiceModel, voiceSpeed, voiceChangeEnabled, voiceChangeSourceUrl,
            voiceAudioUrl, audioDuration } = req.body

    if (!voiceAudioUrl) throw new AppError('voiceAudioUrl is required — complete a voice preview before submitting', 400)

    const celeb = await prisma.celebrity.findUnique({ where: { id: celebrityId } })
    if (!celeb || !celeb.isActive) throw new AppError('Celebrity not found or inactive', 404)

    // Check script against blocked words
    if (script) {
      const settings = await prisma.settings.findUnique({ where: { key: 'default' } })
      const blockedWords: string[] = settings?.blockedWords ?? []
      const scriptLower = script.toLowerCase()
      const found = blockedWords.filter((word: string) => {
        const regex = new RegExp(`\\b${word.toLowerCase()}\\b`)
        return regex.test(scriptLower)
      })
      if (found.length > 0) throw new AppError(`Script contains prohibited content: ${found.join(', ')}`, 422)
    }

    // Estimate price from priceRange Json
    const priceRange = celeb.priceRange as Record<string, { min: number; max: number }>
    const range = priceRange?.[productType as string]
    const estimatedPrice = range ? Math.floor((range.min + range.max) / 2) : 0

    const statusHistory = [{ status: 'pending', timestamp: new Date().toISOString() }]

    const job = await prisma.videoJob.create({
      data: {
        referenceId: generateRef(),
        userId: req.userId!,
        celebrityId,
        productType,
        purpose,
        templateId,
        script,
        tone,
        duration:    duration    || '30s',
        aspectRatio: aspectRatio || '16:9',
        resolution:  resolution  || '1080p',
        channels:    channels    || [],
        estimatedPrice,
        statusHistory,
        propImages:          Array.isArray(propImages) && propImages.length ? propImages : [],
        sceneNotes:          sceneNotes         || undefined,
        backgroundImageUrl:  backgroundImageUrl || undefined,
        voiceModel:          voiceModel         || undefined,
        voiceSpeed:          voiceSpeed != null ? Number(voiceSpeed) : undefined,
        voiceChangeEnabled:  voiceChangeEnabled === true || voiceChangeEnabled === 'true' || false,
        voiceChangeSourceUrl: voiceChangeSourceUrl || undefined,
        voiceAudioUrl:       voiceAudioUrl      || undefined,
        audioDuration:       audioDuration != null ? Number(audioDuration) : undefined,
      },
    })

    // Increment celebrity order count
    await prisma.celebrity.update({ where: { id: celebrityId }, data: { totalOrders: { increment: 1 } } })

    // Dispatch to queue (non-blocking)
    await queueService.dispatchVideoJob(job.id)

    res.status(201).json({ success: true, data: job })
  } catch (err) {
    next(err)
  }
}

export async function previewVoice(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { celebrityId, script, voiceModel, voiceSpeed, voiceChangeEnabled, voiceChangeSourceUrl } = req.body

    if (!celebrityId) throw new AppError('celebrityId is required', 400)
    const isVoiceChange = voiceChangeEnabled && voiceChangeSourceUrl
    if (!isVoiceChange && !script?.trim()) throw new AppError('script is required when not using voice change', 400)

    const celeb = await prisma.celebrity.findUnique({ where: { id: celebrityId } })
    if (!celeb || !celeb.isActive) throw new AppError('Celebrity not found or inactive', 404)
    if (!celeb.voiceModelId) throw new AppError('Celebrity has no voice model configured', 400)

    const speed = voiceSpeed != null ? Number(voiceSpeed) : undefined
    let audioUrl: string
    let durationSecs: number | undefined

    if (voiceChangeEnabled && voiceChangeSourceUrl) {
      const srcRes = await fetch(voiceChangeSourceUrl as string)
      if (!srcRes.ok) throw new AppError('Failed to fetch source audio', 400)
      const srcBuffer = Buffer.from(await srcRes.arrayBuffer())
      const result = await aiService.changeVoice({
        targetVoiceId: celeb.voiceModelId,
        audioBuffer:   srcBuffer,
        audioMimeType: srcRes.headers.get('content-type') || 'audio/mpeg',
        celebSlug:     celeb.slug,
        model:         voiceModel as ElevenLabsSTSModel | undefined,
        speed,
      })
      audioUrl = result.audioUrl
    } else {
      const STS_MODELS = ['eleven_multilingual_sts_v2', 'eleven_english_sts_v2']
      const safeTTSModel: ElevenLabsTTSModel = STS_MODELS.includes(voiceModel)
        ? 'eleven_v3'
        : (voiceModel as ElevenLabsTTSModel | undefined) ?? 'eleven_v3'
      const result = await aiService.generateVoice(
        celeb.voiceModelId,
        String(script),
        celeb.slug,
        { model: safeTTSModel, speed },
      )
      audioUrl     = result.audioUrl
      durationSecs = result.durationSecs
    }

    res.json({ success: true, audioUrl, durationSecs })
  } catch (err) {
    next(err)
  }
}

export async function getMyStats(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const grouped = await prisma.videoJob.groupBy({
      by: ['status'],
      where: { userId: req.userId },
      _count: { status: true },
    })
    const stats: Record<string, number> = { all: 0, pending: 0, 'in-progress': 0, review: 0, delivered: 0, cancelled: 0, failed: 0 }
    for (const row of grouped) {
      // Prisma enum value is in_progress but DB/JSON representation is 'in-progress'
      const rawStatus = row.status as string
      // Convert Prisma enum name back to the hyphenated string used in stats keys
      const s = rawStatus === 'in_progress' ? 'in-progress' : rawStatus
      if (s in stats) stats[s] = row._count.status
      stats.all += row._count.status
    }
    res.json({ success: true, data: stats })
  } catch (err) {
    next(err)
  }
}

export async function getMyJobs(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { status, page = '1', limit = '12' } = req.query
    const where: Record<string, unknown> = { userId: req.userId }
    if (status && status !== 'all') {
      // Convert 'in-progress' query param to Prisma enum value 'in_progress'
      where.status = (status as string) === 'in-progress' ? 'in_progress' : status
    }

    const pageNum  = Math.max(1, parseInt(page  as string, 10) || 1)
    const limitNum = Math.min(50, Math.max(1, parseInt(limit as string, 10) || 12))
    const skip     = (pageNum - 1) * limitNum

    const [raw, total] = await Promise.all([
      prisma.videoJob.findMany({
        where,
        include: {
          celebrity: { select: { name: true, nameAr: true, initials: true, avatarColor: true, thumbnailUrl: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limitNum,
      }),
      prisma.videoJob.count({ where }),
    ])

    const data = await Promise.all(raw.map(j => signJobThumbnail(j as unknown as Record<string, unknown>)))
    res.json({ success: true, data, total, page: pageNum, pages: Math.ceil(total / limitNum), hasMore: skip + data.length < total })
  } catch (err) {
    next(err)
  }
}

export async function getJob(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const raw = await prisma.videoJob.findFirst({
      where: { referenceId: req.params.referenceId, userId: req.userId },
      include: {
        celebrity: { select: { name: true, nameAr: true, initials: true, avatarColor: true, thumbnailUrl: true } },
      },
    })
    if (!raw) throw new AppError('Job not found', 404)
    res.json({ success: true, data: await signJobThumbnail(raw as unknown as Record<string, unknown>) })
  } catch (err) {
    next(err)
  }
}

export async function submitBookCall(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { referenceId } = req.params
    const { name, email, phone, company, notes } = req.body

    const job = await prisma.videoJob.findFirst({
      where: { referenceId, userId: req.userId },
      include: { celebrity: { select: { name: true } } },
    })
    if (!job) throw new AppError('Job not found', 404)

    const celeb = job.celebrity as { name: string }
    const statusHistory = [{ status: 'new', timestamp: new Date().toISOString() }]

    const lead = await prisma.lead.create({
      data: {
        userId:       req.userId,
        videoJobId:   job.id,
        name, email, phone, company, notes,
        celebrityName: celeb.name,
        productType:  job.productType as string,
        purpose:      job.purpose,
        estimatedValue: job.estimatedPrice,
        currency:     job.currency,
        source:       'book_call',
        statusHistory,
      },
    })

    emailService.sendNewLeadNotification(lead as any).catch(() => null)
    res.status(201).json({ success: true, data: lead, message: 'Sales inquiry submitted successfully' })
  } catch (err) {
    next(err)
  }
}

export async function cancelJob(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const job = await prisma.videoJob.findFirst({
      where: { referenceId: req.params.referenceId, userId: req.userId },
    })
    if (!job) throw new AppError('Job not found', 404)
    if (job.status !== 'pending') throw new AppError('Only pending jobs can be cancelled', 400)

    const history = await appendStatusHistory(job.id, { status: 'cancelled', timestamp: new Date().toISOString(), note: 'Cancelled by customer' })
    const updated = await prisma.videoJob.update({
      where: { id: job.id },
      data: { status: 'cancelled', statusHistory: history as any },
    })

    res.json({ success: true, data: updated })
  } catch (err) {
    next(err)
  }
}

// Admin — list all jobs
export async function adminListJobs(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { status, userId, page = 1, limit = 20 } = req.query
    const where: Record<string, unknown> = {}
    if (status) where.status = (status as string) === 'in-progress' ? 'in_progress' : status
    if (userId) where.userId = userId

    const skip = (Number(page) - 1) * Number(limit)
    const [jobs, total] = await Promise.all([
      prisma.videoJob.findMany({
        where,
        include: {
          user:      { select: { name: true, email: true } },
          celebrity: { select: { name: true, initials: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: Number(limit),
      }),
      prisma.videoJob.count({ where }),
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
    const { status, note } = req.body as { status: string; note?: string }

    const job = await prisma.videoJob.findUnique({ where: { id } })
    if (!job) throw new AppError('Job not found', 404)

    const prismaStatus = status === 'in-progress' ? 'in_progress' : status

    const history = await appendStatusHistory(id, { status, timestamp: new Date().toISOString(), note })
    const updateData: Record<string, unknown> = {
      status: prismaStatus,
      statusHistory: history as any,
    }
    if (status === 'delivered') {
      updateData.deliveredAt = new Date()
      updateData.downloadEnabled = true
    }
    const updated = await prisma.videoJob.update({ where: { id }, data: updateData })

    // Notify user
    prisma.user.findUnique({ where: { id: job.userId } }).then(user => {
      if (user) emailService.sendJobStatusUpdate(user.email, user.name, status as any, job.referenceId).catch(() => null)
    }).catch(() => null)

    res.json({ success: true, data: updated })
  } catch (err) {
    next(err)
  }
}

// Admin — approve job (review → delivered)
export async function adminApproveJob(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const job = await prisma.videoJob.findUnique({ where: { id: req.params.id } })
    if (!job) throw new AppError('Job not found', 404)
    if (job.status !== 'review') throw new AppError('Job must be in review status to approve', 400)

    const history = await appendStatusHistory(job.id, { status: 'delivered', timestamp: new Date().toISOString(), note: 'Approved by CS team' })
    const updated = await prisma.videoJob.update({
      where: { id: job.id },
      data: {
        status: 'delivered',
        downloadEnabled: true,
        deliveredAt: new Date(),
        statusHistory: history as any,
      },
    })

    prisma.user.findUnique({ where: { id: job.userId } }).then(user => {
      if (user) emailService.sendJobStatusUpdate(user.email, user.name, 'delivered', job.referenceId).catch(() => null)
    }).catch(() => null)

    res.json({ success: true, data: updated, message: 'Job approved and delivered to customer' })
  } catch (err) {
    next(err)
  }
}

// Admin — reject job (review → failed)
export async function adminRejectJob(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { note } = req.body as { note?: string }
    const job = await prisma.videoJob.findUnique({ where: { id: req.params.id } })
    if (!job) throw new AppError('Job not found', 404)
    if (job.status !== 'review') throw new AppError('Job must be in review status to reject', 400)

    const errorMessage = note || 'Rejected by CS team'
    const history = await appendStatusHistory(job.id, { status: 'failed', timestamp: new Date().toISOString(), note: errorMessage })
    const updated = await prisma.videoJob.update({
      where: { id: job.id },
      data: {
        status: 'failed',
        errorMessage,
        statusHistory: history as any,
      },
    })

    prisma.user.findUnique({ where: { id: job.userId } }).then(user => {
      if (user) emailService.sendJobStatusUpdate(user.email, user.name, 'failed', job.referenceId).catch(() => null)
    }).catch(() => null)

    res.json({ success: true, data: updated, message: 'Job rejected' })
  } catch (err) {
    next(err)
  }
}

// Authenticated — suggest scene prompts with AI
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
      propImages?: string[]
    }
    if (!prompt?.trim()) throw new AppError('prompt is required', 400)

    const settings = await settingsService.get()
    if (!settings.geminiApiKey) {
      throw new AppError('Gemini API key not configured. Please add it in Admin > Settings.', 503)
    }

    let geminiSystemPrompt: string | undefined
    if (productTypeSlug) {
      const pt = await prisma.productType.findUnique({ where: { slug: productTypeSlug } })
      if (pt?.geminiSystemPrompt?.trim()) {
        geminiSystemPrompt = pt.geminiSystemPrompt
      }
    }

    type GeminiPart = { text?: string; inlineData?: { mimeType: string; data: string } }
    const contents: Array<{ role: string; parts: GeminiPart[] }> = []

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

    const currentParts: GeminiPart[] = []

    if (celebrityImageUrl?.trim()) {
      const part = await urlToInlinePart(celebrityImageUrl)
      if (part) currentParts.push(part)
    }

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
      requestBody.systemInstruction = { role: 'system', parts: [{ text: geminiSystemPrompt }] }
    }

    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro-image-preview:generateContent?key=${settings.geminiApiKey}`,
      {
        method: 'POST',
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

    const imgBuffer = Buffer.from(imagePart.inlineData.data, 'base64')
    const imgMime   = imagePart.inlineData.mimeType
    const imgExt    = imgMime.split('/')[1] || 'png'
    const userId    = req.userId ?? 'anon'
    const imgKey    = `generated-images/${userId}/${Date.now()}.${imgExt}`
    const { s3Bucket } = await settingsService.get()
    const upload = await s3Service.upload(s3Bucket, imgKey, imgBuffer, imgMime)

    const imageUrl = upload.stub
      ? upload.url
      : await s3Service.getPresignedUrl(s3Bucket, upload.key, 86_400)

    const textPart = parts.find(p => p.text)
    res.json({ success: true, imageUrl, revisedPrompt: textPart?.text })
  } catch (err) {
    next(err)
  }
}

// Authenticated — upload a user asset to S3
export async function uploadAsset(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { dataUrl } = req.body as { dataUrl?: string }
    if (!dataUrl?.trim()) throw new AppError('dataUrl is required', 400)

    const match = dataUrl.match(/^data:((image|audio)\/[^;]+);base64,(.+)$/)
    if (!match) throw new AppError('dataUrl must be a valid base64 image or audio data URL', 400)

    const mimeType = match[1]
    const ext      = mimeType.split('/')[1]?.split(';')[0] || 'bin'
    const buffer   = Buffer.from(match[3], 'base64')
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

// Customer — stream video download
export async function getJobDownloadUrl(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const job = await prisma.videoJob.findFirst({
      where: { referenceId: req.params.referenceId, userId: req.userId },
    })
    if (!job) throw new AppError('Job not found', 404)
    if (!job.downloadEnabled) throw new AppError('Download not enabled for this job', 403)

    const rawUrl = job.finalVideoUrl || job.watermarkedUrl
    if (!rawUrl) throw new AppError('No video file available yet', 404)

    const fetchUrl = (await s3Service.presignIfS3(rawUrl)) ?? rawUrl

    const upstream = await fetch(fetchUrl)
    if (!upstream.ok) throw new AppError('Could not retrieve video file', 502)

    const filename = `${job.referenceId}.mp4`
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
    res.setHeader('Content-Type', upstream.headers.get('content-type') ?? 'video/mp4')
    const contentLength = upstream.headers.get('content-length')
    if (contentLength) res.setHeader('Content-Length', contentLength)

    const buffer = Buffer.from(await upstream.arrayBuffer())
    res.send(buffer)
  } catch (err) {
    next(err)
  }
}

// Admin — enable download
export async function adminEnableDownload(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const job = await prisma.videoJob.update({
      where: { id: req.params.id },
      data: { downloadEnabled: true },
    })
    res.json({ success: true, data: job, message: 'Download enabled' })
  } catch (err) {
    if ((err as any)?.code === 'P2025') {
      next(new AppError('Job not found', 404))
    } else {
      next(err)
    }
  }
}
