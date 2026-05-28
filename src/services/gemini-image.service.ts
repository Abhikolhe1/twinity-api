/**
 * Gemini Image Service — generates advertising still images via Google Gemini.
 *
 * Model: gemini-3.1-flash-image-preview
 * Auth:  API key from settings DB (gemini_api_key) — no env var equivalent.
 *
 * Note: Gemini blocks requests that include real person photos (deepfake
 * prevention) and refuses named-person prompts. Image ads are therefore
 * generated from the campaign brief text alone.
 *
 * Stub mode: when gemini_api_key is absent, returns a placeholder URL immediately.
 */
import { logger } from '../config/logger'
import { settingsService } from './settings.service'
import { s3Service } from './s3.service'

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta'
const MODEL       = 'gemini-3.1-flash-image-preview'

export interface GeminiImageResult {
  imageUrl:  string
  mimeType:  string
  status:    'generated' | 'stub'
}

export async function generateGeminiImage(params: {
  prompt:      string
  referenceId: string
  s3Bucket:    string
}): Promise<GeminiImageResult> {
  const { geminiApiKey } = await settingsService.get()

  if (!geminiApiKey) {
    logger.warn('[GeminiImage] gemini_api_key not set — returning stub')
    return {
      imageUrl: 'https://placehold.co/1280x720/7C3AED/FFFFFF?text=Gemini+Image+Ad+%28stub%29',
      mimeType: 'image/png',
      status:   'stub',
    }
  }

  logger.info(`[GeminiImage] Generating image for ${params.referenceId}`)

  const endpoint = `${GEMINI_BASE}/models/${MODEL}:generateContent?key=${geminiApiKey}`

  const body = {
    contents: [
      {
        parts: [{ text: params.prompt }],
      },
    ],
    generationConfig: {
      responseModalities: ['TEXT', 'IMAGE'],
    },
  }

  const res = await fetch(endpoint, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  })

  if (!res.ok) {
    const errText = await res.text()
    throw new Error(`Gemini image generation failed (${res.status}): ${errText}`)
  }

  const data = await res.json() as {
    candidates?: Array<{
      content?: {
        parts?: Array<{
          text?: string
          inlineData?: { data: string; mimeType: string }
        }>
      }
      finishReason?: string
      safetyRatings?: Array<{ category: string; probability: string }>
    }>
    promptFeedback?: {
      blockReason?: string
    }
  }

  if (data.promptFeedback?.blockReason) {
    throw new Error(`Gemini prompt blocked: ${data.promptFeedback.blockReason}`)
  }

  const candidate = data.candidates?.[0]
  const parts = candidate?.content?.parts ?? []
  const imagePart = parts.find(p => p.inlineData?.data)

  if (!imagePart?.inlineData) {
    const finishReason = candidate?.finishReason
    const textResponse = parts.filter(p => p.text).map(p => p.text).join(' ').slice(0, 400)
    logger.error(`[GeminiImage] No image in response for ${params.referenceId}`, {
      finishReason,
      textResponse: textResponse || '(none)',
      candidateCount: data.candidates?.length ?? 0,
    })
    throw new Error(
      `Gemini returned no image (finishReason: ${finishReason ?? 'unknown'}${textResponse ? ` — model said: ${textResponse}` : ''})`
    )
  }

  const { data: base64, mimeType } = imagePart.inlineData
  const imageBuffer = Buffer.from(base64, 'base64')

  const ext = mimeType === 'image/jpeg' ? 'jpg' : 'png'
  const key = `jobs/${params.referenceId}/generated-image.${ext}`

  const upload = await s3Service.upload(params.s3Bucket, key, imageBuffer, mimeType)

  const imageUrl = upload.stub
    ? upload.url
    : await s3Service.getPresignedUrl(params.s3Bucket, upload.key, 86400)

  logger.info(`[GeminiImage] Done: ${params.referenceId} → ${imageUrl}`)
  return { imageUrl, mimeType, status: 'generated' }
}
