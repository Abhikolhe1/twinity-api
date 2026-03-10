/**
 * AI Service — integrates ElevenLabs, SyncLabs, and Higgsfield AI.
 * API keys are loaded dynamically from the Settings DB (via settingsService).
 *
 * Higgsfield Platform API (https://platform.higgsfield.ai):
 *   - Auth:    Authorization: Key {CLIENT_KEY}:{SECRET_KEY}
 *   - Format:  JSON body — NOT multipart uploads
 *   - Webhook: ?hf_webhook=<your-url> query parameter on each request
 *
 * Soul ID / character training is done through the Higgsfield web dashboard
 * (https://cloud.higgsfield.ai) — upload 20-80 photos + audio there, then
 * copy the Soul ID into the celebrity's "Avatar Model ID" field here.
 *
 * All methods fall back to stubs when credentials are not configured.
 */
import { logger } from '../config/logger'
import { settingsService } from './settings.service'
import { s3Service } from './s3.service'

export interface AvatarSubmitResult { requestId: string; status: 'training' | 'stub' }
export interface VideoSubmitResult  { requestId: string; status: 'submitted' | 'stub' }
export interface VoiceCloneResult   { jobId: string; audioUrl: string }
export interface LipSyncResult      { jobId: string; videoUrl: string }

// ─── Higgsfield Platform API ───────────────────────────────────────────────
const HIGGSFIELD_BASE = 'https://platform.higgsfield.ai'

function higgsfieldAuth(apiKey: string, apiSecret: string): string {
  return `Key ${apiKey}:${apiSecret}`
}

async function higgsfieldPost(
  modelId: string,
  body: object,
  apiKey: string,
  apiSecret: string,
  webhookUrl?: string,
): Promise<any> {
  const url = webhookUrl
    ? `${HIGGSFIELD_BASE}/${modelId}?hf_webhook=${encodeURIComponent(webhookUrl)}`
    : `${HIGGSFIELD_BASE}/${modelId}`

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': higgsfieldAuth(apiKey, apiSecret),
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Higgsfield ${modelId} failed (${res.status}): ${err}`)
  }
  return res.json()
}

// ─── ElevenLabs ───────────────────────────────────────────────────────────
const ELEVENLABS_BASE = 'https://api.elevenlabs.io/v1'

// ─── SyncLabs ─────────────────────────────────────────────────────────────
const SYNCLABS_BASE = 'https://api.sync.so/v2'

// ─── Exported service ─────────────────────────────────────────────────────

export const aiService = {
  /**
   * NOTE: Soul ID / avatar training is done manually via the Higgsfield dashboard.
   *
   * Workflow:
   *  1. Go to https://cloud.higgsfield.ai/character
   *  2. Create a new Soul — upload 20-80 photos + 2-5 min audio
   *  3. Copy the resulting Soul ID
   *  4. Paste it into the celebrity's "Avatar Model ID" field in Twinity admin
   *
   * This stub stores the provided Soul ID immediately without calling Higgsfield.
   * It is called when the admin saves a Soul ID directly in the celebrity form.
   */
  async createAvatar(params: {
    soulId: string
    name: string
  }): Promise<AvatarSubmitResult> {
    logger.info(`[AI] Registering Higgsfield Soul ID for: ${params.name}, id=${params.soulId}`)
    // The Soul ID already exists (created via Higgsfield dashboard) — just return it
    return { requestId: params.soulId, status: 'stub' }
  },

  /**
   * Higgsfield Soul — submit video render job.
   * Returns immediately with a request_id.
   * Completion delivered via webhook (hf_webhook query param).
   *
   * Model: higgsfield-ai/soul/standard
   * Docs:  https://docs.higgsfield.ai/how-to/introduction
   */
  async renderVideo(params: {
    characterId: string   // Soul ID from Higgsfield dashboard
    script: string
    duration: string
    aspectRatio: string
    watermarkText: string
    webhookUrl?: string
  }): Promise<VideoSubmitResult> {
    logger.info(`[AI] Higgsfield submitVideo: soulId=${params.characterId}`)
    const { higgsfieldKey, higgsfieldSecret } = await settingsService.get()

    if (!higgsfieldKey || !higgsfieldSecret || params.characterId.startsWith('stub-')) {
      logger.warn('[AI] Higgsfield credentials not set — returning stub')
      return { requestId: `stub-render-${Date.now()}`, status: 'stub' }
    }

    // Build a natural language prompt from the script
    const prompt = params.script.length > 800
      ? params.script.slice(0, 800)
      : params.script

    const data = await higgsfieldPost(
      'higgsfield-ai/soul/standard',
      {
        prompt,
        soul_id:      params.characterId,
        aspect_ratio: params.aspectRatio,
        resolution:   '1080p',
        duration:     params.duration,
      },
      higgsfieldKey,
      higgsfieldSecret,
      params.webhookUrl,
    )

    const requestId = String(data.request_id ?? data.id)
    logger.info(`[AI] Higgsfield video render queued, request_id=${requestId}`)
    return { requestId, status: 'submitted' }
  },

  /**
   * ElevenLabs — synthesise audio from script using celebrity's cloned voice.
   * Uploads the resulting audio buffer to S3 and returns the public URL.
   */
  async generateVoice(
    celebrityVoiceId: string,
    script: string,
    celebSlug: string,
  ): Promise<VoiceCloneResult> {
    logger.info(`[AI] ElevenLabs voice gen: celebrity=${celebrityVoiceId}`)
    const { elevenLabsKey } = await settingsService.get()

    if (!elevenLabsKey) {
      logger.warn('[AI] ElevenLabs key not set — returning stub')
      return { jobId: `stub-voice-${Date.now()}`, audioUrl: 'https://stub-audio.mp3' }
    }

    const res = await fetch(`${ELEVENLABS_BASE}/text-to-speech/${celebrityVoiceId}`, {
      method: 'POST',
      headers: { 'xi-api-key': elevenLabsKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: script, model_id: 'eleven_multilingual_v2' }),
    })
    if (!res.ok) throw new Error(`ElevenLabs failed (${res.status})`)

    const jobId = `el-${Date.now()}`
    const audioBuffer = Buffer.from(await res.arrayBuffer())
    const { s3Bucket } = await settingsService.get()
    const key = `celebrities/${celebSlug}/generated-audio/${jobId}.mp3`
    const upload = await s3Service.upload(s3Bucket, key, audioBuffer, 'audio/mpeg')

    logger.info(`[AI] ElevenLabs audio uploaded: ${upload.url}`)
    return { jobId, audioUrl: upload.url }
  },

  /**
   * SyncLabs — lip-sync an audio track to a celebrity avatar video.
   */
  async lipSync(avatarVideoUrl: string, audioUrl: string): Promise<LipSyncResult> {
    logger.info(`[AI] SyncLabs lip-sync: avatar=${avatarVideoUrl}`)
    const { syncLabsKey } = await settingsService.get()

    if (!syncLabsKey) {
      logger.warn('[AI] SyncLabs key not set — returning stub')
      return { jobId: `stub-lipsync-${Date.now()}`, videoUrl: 'https://stub-lipsync.mp4' }
    }

    const res = await fetch(`${SYNCLABS_BASE}/generate`, {
      method: 'POST',
      headers: { 'x-api-key': syncLabsKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ audioUrl, videoUrl: avatarVideoUrl, synergize: true }),
    })
    if (!res.ok) throw new Error(`SyncLabs failed (${res.status})`)
    const data = await res.json() as { id: string; videoUrl?: string }
    return { jobId: data.id, videoUrl: data.videoUrl ?? 'https://stub-lipsync.mp4' }
  },
}
