/**
 * Template Asset Service — generates a composite image by placing a celebrity
 * on a template background using the Gemini image generation API.
 *
 * Both images are downloaded, base64-encoded, and sent to Gemini as inline
 * parts alongside a compositing prompt. The result is archived to S3.
 *
 * Auth:  gemini_api_key from the settings DB (same key used by Image Ad).
 * Stub:  when the key is absent, returns the celebrity image URL unchanged.
 */
import { logger } from '../config/logger'
import { settingsService } from './settings.service'
import { s3Service } from './s3.service'

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta'
const MODEL       = 'gemini-3.1-flash-image-preview'

interface GeminiPart {
  text?:       string
  inlineData?: { data: string; mimeType: string }
}

interface GeminiResponse {
  candidates?: Array<{
    content?:     { parts?: GeminiPart[] }
    finishReason?: string
  }>
  promptFeedback?: { blockReason?: string }
}

async function fetchAsBase64(url: string): Promise<{ data: string; mimeType: string }> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Failed to download image (${res.status}): ${url}`)
  const mimeType = res.headers.get('content-type')?.split(';')[0] || 'image/jpeg'
  const data     = Buffer.from(await res.arrayBuffer()).toString('base64')
  return { data, mimeType }
}

export async function generateCompositeImage(params: {
  celebrityImageUrl:  string
  backgroundImageUrl: string
  referenceId:        string
}): Promise<string> {
  const { geminiApiKey, s3Bucket } = await settingsService.get()

  if (!geminiApiKey) {
    logger.warn('[TemplateAsset] gemini_api_key not set — returning celebrity image as stub')
    return params.celebrityImageUrl
  }

  logger.info(`[TemplateAsset] Generating composite via Gemini: ref=${params.referenceId}`)

  const [background, celebrity] = await Promise.all([
    fetchAsBase64(params.backgroundImageUrl),
    fetchAsBase64(params.celebrityImageUrl),
  ])

  const endpoint = `${GEMINI_BASE}/models/${MODEL}:generateContent?key=${geminiApiKey}`

  const body = {
    contents: [{
      parts: [
        { inlineData: background },
        { inlineData: celebrity },
        {
          text: 'Place the person from the second image naturally onto the background from the first image. Maintain realistic proportions, lighting, and shadows. Output a single high-quality composite image.',
        },
      ],
    }],
    generationConfig: { responseModalities: ['IMAGE'] },
  }

  const res = await fetch(endpoint, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  })

  if (!res.ok) {
    const errText = await res.text()
    throw new Error(`Gemini composite generation failed (${res.status}): ${errText}`)
  }

  const data = await res.json() as GeminiResponse

  if (data.promptFeedback?.blockReason) {
    throw new Error(`Gemini prompt blocked: ${data.promptFeedback.blockReason}`)
  }

  const parts        = data.candidates?.[0]?.content?.parts ?? []
  const imagePart    = parts.find(p => p.inlineData?.data)
  const finishReason = data.candidates?.[0]?.finishReason

  if (!imagePart?.inlineData) {
    throw new Error(`Gemini returned no composite image (finishReason: ${finishReason ?? 'unknown'})`)
  }

  const { data: base64, mimeType } = imagePart.inlineData
  const imageBuffer = Buffer.from(base64, 'base64')
  const ext         = mimeType === 'image/jpeg' ? 'jpg' : 'png'
  const key         = `template-assets/${params.referenceId}.${ext}`
  const upload      = await s3Service.upload(s3Bucket, key, imageBuffer, mimeType)

  logger.info(`[TemplateAsset] Composite stored: ${upload.url}`)
  return upload.url
}
