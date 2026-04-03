/**
 * AI Service — integrates ElevenLabs (TTS voice) and Higgsfield (lip-sync video).
 * API keys are loaded dynamically from the Settings DB (via settingsService).
 *
 * Pipeline:
 *   1. generateVoice()      — ElevenLabs TTS using celebrity's cloned voiceModelId → MP3
 *   2. higgsfieldLipSync()  — Higgsfield: celebrity image + MP3 → lip-synced video (async)
 *
 * All methods fall back to stubs when credentials are not configured.
 */
import FormDataLib from 'form-data'
import { logger } from '../config/logger'
import { settingsService } from './settings.service'
import { s3Service } from './s3.service'

export interface VoiceCloneResult   { jobId: string; audioUrl: string }
export interface VoiceCloneIdResult { voiceId: string }

// ─── ElevenLabs ───────────────────────────────────────────────────────────────
const ELEVENLABS_BASE = 'https://api.elevenlabs.io/v1'

// ─── Preview sample texts per language ───────────────────────────────────────
const PREVIEW_SAMPLES: Record<string, string> = {
  ar: 'مرحباً، أنا سعيد بالتحدث معك اليوم.',
  en: 'Hello, I am excited to connect with you today.',
}

/**
 * Generates a short TTS clip using the just-created voice.
 * This populates the "sample to play" button in the ElevenLabs My Voices dashboard.
 * Errors are swallowed — a failed preview does not affect the voice itself.
 */
async function generateVoicePreview(voiceId: string, language: string, apiKey: string): Promise<void> {
  try {
    const sampleText = PREVIEW_SAMPLES[language] ?? PREVIEW_SAMPLES['en']
    logger.info(`[AI] Generating ElevenLabs preview sample for voice_id=${voiceId}`)
    const res = await fetch(`${ELEVENLABS_BASE}/text-to-speech/${voiceId}`, {
      method: 'POST',
      headers: { 'xi-api-key': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: sampleText, model_id: 'eleven_multilingual_v2' }),
    })
    if (!res.ok) {
      const err = await res.text()
      logger.warn(`[AI] ElevenLabs preview sample failed (${res.status}): ${err}`)
      return
    }
    // Drain response body — we only need to trigger the generation, not store the audio
    await res.arrayBuffer()
    logger.info(`[AI] ElevenLabs preview sample generated for voice_id=${voiceId}`)
  } catch (err) {
    logger.warn(`[AI] ElevenLabs preview sample error (non-fatal): ${String(err)}`)
  }
}

// ─── Higgsfield API ───────────────────────────────────────────────────────────
const HIGGSFIELD_BASE = 'https://platform.higgsfield.ai'

export interface HiggsfieldResult { jobId: string; status: 'submitted' | 'stub' }

// ─── OpenAI API ───────────────────────────────────────────────────────────────
const OPENAI_BASE = 'https://api.openai.com'

// ─── Exported service ─────────────────────────────────────────────────────────

export const aiService = {
  /**
   * ElevenLabs — synthesise audio from script using celebrity's cloned voice.
   * Uploads the resulting audio buffer to S3 and returns the public URL.
   */
  async generateVoice(
    celebrityVoiceId: string,
    script: string,
    celebSlug: string,
  ): Promise<VoiceCloneResult> {
    logger.info(`[AI] ElevenLabs voice gen: voiceId=${celebrityVoiceId}`)
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
    // Generate a pre-signed URL so Higgsfield can download the private S3 object.
    // Valid for 2 hours — enough time for Higgsfield to process the job.
    // Pre-sign the S3 URL so Higgsfield can download the private audio object (valid 2 hours)
    const audioUrl = upload.stub
      ? upload.url
      : await s3Service.getPresignedUrl(s3Bucket, upload.key, 7200)

    logger.info(`[AI] ElevenLabs audio uploaded: ${upload.url}`)
    return { jobId, audioUrl }
  },

  /**
   * ElevenLabs — create a voice clone from sample audio files.
   * Accepts 1-25 audio samples; returns the new ElevenLabs voice_id.
   * The caller is responsible for saving the voiceId on the Celebrity document.
   */
  async cloneVoice(params: {
    name: string
    language: string
    audioFiles: Array<{ buffer: Buffer; originalname: string; mimetype: string }>
    existingVoiceId?: string   // if set, edit that voice instead of creating a new one
  }): Promise<VoiceCloneIdResult> {
    const action = params.existingVoiceId ? `edit voice_id=${params.existingVoiceId}` : 'add new'
    logger.info(`[AI] ElevenLabs cloneVoice: ${action}, lang=${params.language}, files=${params.audioFiles.length}`)
    const { elevenLabsKey } = await settingsService.get()

    if (!elevenLabsKey) {
      logger.warn('[AI] ElevenLabs key not set — returning stub voice ID')
      return { voiceId: params.existingVoiceId ?? `stub-voice-${Date.now()}` }
    }

    // Use form-data package — Node.js native FormData + Blob does not
    // correctly set per-part Content-Type headers for binary buffers,
    // causing ElevenLabs to receive empty/unrecognised audio files.
    const form = new FormDataLib()
    form.append('name', params.name)
    // ElevenLabs stores language inside the labels JSON object, not as a top-level field
    form.append('labels', JSON.stringify({ language: params.language }))
    for (const file of params.audioFiles) {
      form.append('files', file.buffer, {
        filename:    file.originalname,
        contentType: file.mimetype || 'audio/mpeg',
        knownLength: file.buffer.length,
      })
    }

    if (params.existingVoiceId) {
      // Edit the existing voice — adds the new samples to it without creating a new voice_id
      const res = await fetch(`${ELEVENLABS_BASE}/voices/${params.existingVoiceId}/edit`, {
        method: 'POST',
        headers: {
          'xi-api-key': elevenLabsKey,
          ...form.getHeaders(),
        },
        // @ts-ignore — form-data getBuffer() is a Buffer, which fetch accepts
        body: form.getBuffer(),
      })
      if (!res.ok) {
        const errText = await res.text()
        // Voice was deleted from ElevenLabs but ID is still stored in our DB.
        // Fall through to create a new clone instead of failing the request.
        let isNotFound = false
        try {
          const errJson = JSON.parse(errText) as { detail?: { status?: string } }
          isNotFound = errJson.detail?.status === 'invalid_voice_id'
        } catch { /* not JSON */ }

        if (isNotFound) {
          logger.warn(`[AI] ElevenLabs voice ${params.existingVoiceId} not found — creating new clone instead`)
          // Re-build form (getBuffer() can only be consumed once)
          const form2 = new FormDataLib()
          form2.append('name', params.name)
          form2.append('labels', JSON.stringify({ language: params.language }))
          for (const file of params.audioFiles) {
            form2.append('files', file.buffer, {
              filename:    file.originalname,
              contentType: file.mimetype || 'audio/mpeg',
              knownLength: file.buffer.length,
            })
          }
          const res2 = await fetch(`${ELEVENLABS_BASE}/voices/add`, {
            method: 'POST',
            headers: { 'xi-api-key': elevenLabsKey, ...form2.getHeaders() },
            // @ts-ignore
            body: form2.getBuffer(),
          })
          if (!res2.ok) {
            const err2 = await res2.text()
            throw new Error(`ElevenLabs voice clone failed (${res2.status}): ${err2}`)
          }
          const data2 = await res2.json() as { voice_id: string }
          logger.info(`[AI] ElevenLabs new voice cloned (fallback): voice_id=${data2.voice_id}`)
          await generateVoicePreview(data2.voice_id, params.language, elevenLabsKey)
          return { voiceId: data2.voice_id }
        }

        throw new Error(`ElevenLabs voice edit failed (${res.status}): ${errText}`)
      }
      logger.info(`[AI] ElevenLabs voice updated: voice_id=${params.existingVoiceId}`)
      await generateVoicePreview(params.existingVoiceId, params.language, elevenLabsKey)
      return { voiceId: params.existingVoiceId }
    }

    // Create a brand new voice clone
    const res = await fetch(`${ELEVENLABS_BASE}/voices/add`, {
      method: 'POST',
      headers: {
        'xi-api-key': elevenLabsKey,
        ...form.getHeaders(),
      },
      // @ts-ignore — form-data getBuffer() is a Buffer, which fetch accepts
      body: form.getBuffer(),
    })
    if (!res.ok) {
      const err = await res.text()
      throw new Error(`ElevenLabs voice clone failed (${res.status}): ${err}`)
    }
    const data = await res.json() as { voice_id: string }
    logger.info(`[AI] ElevenLabs voice cloned: voice_id=${data.voice_id}`)
    await generateVoicePreview(data.voice_id, params.language, elevenLabsKey)
    return { voiceId: data.voice_id }
  },

  /**
   * Higgsfield — generate a video from a celebrity image using ByteDance Seedance v1 Pro.
   * Accepts a raw image URL and a script prompt; returns a job ID immediately.
   * Completion is delivered via POST {SERVER_URL}/api/webhooks/higgsfield.
   *
   * Auth format: "Key {api_key}:{api_key_secret}" — store both as "apiKey:apiSecret"
   * in the higgsfieldKey settings field (colon-separated).
   */
  async higgsfieldVideoGenerate(params: {
    audioUrl: string
    imageUrl: string
    aspectRatio: string
    referenceId: string
    script: string
    callbackUrl?: string
  }): Promise<HiggsfieldResult> {
    logger.info(`[AI] Higgsfield image-to-video: refId=${params.referenceId}`)
    const { higgsfieldKeyId, higgsfieldKeySecret } = await settingsService.get()

    if (!higgsfieldKeyId || !higgsfieldKeySecret) {
      logger.warn('[AI] Higgsfield key ID / secret not set — returning stub')
      return { jobId: `stub-higgsfield-${Date.now()}`, status: 'stub' }
    }

    const body: Record<string, unknown> = {
      image_url: params.imageUrl,
      prompt:    params.script,
    }

    const endpoint = new URL(`${HIGGSFIELD_BASE}/bytedance/seedance/v1/pro/image-to-video`)
    if (params.callbackUrl) endpoint.searchParams.set('hf_webhook', params.callbackUrl)

    const res = await fetch(endpoint.toString(), {
      method: 'POST',
      headers: {
        'Authorization': `Key ${higgsfieldKeyId}:${higgsfieldKeySecret}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      const err = await res.text()
      throw new Error(`Higgsfield image-to-video failed (${res.status}): ${err}`)
    }
    const data = await res.json() as { id?: string; job_id?: string; request_id?: string }
    const jobId = data.id || data.job_id || data.request_id
    if (!jobId) throw new Error(`Higgsfield: no job ID in response: ${JSON.stringify(data)}`)
    logger.info(`[AI] Higgsfield image-to-video job queued: job_id=${jobId}`)
    return { jobId, status: 'submitted' }
  },

  /**
   * OpenAI — generates 3+ creative scene description suggestions for a video job.
   * Falls back to generic stubs when the key is not set.
   */
  async generateScenePrompts(params: {
    celebrityName: string
    productType: string
    purpose?: string
    script?: string
  }): Promise<string[]> {
    const { openaiKey } = await settingsService.get()

    if (!openaiKey) {
      logger.warn('[AI] OpenAI key not set — returning stub scene prompts')
      return [
        'Professional studio setting with soft, diffused lighting and a clean white background. Minimal, modern aesthetic with subtle brand colours reflected in the environment.',
        'Outdoor urban rooftop at golden hour. Warm sunlight, city skyline in the background, relaxed yet premium atmosphere.',
        'Luxury interior — warm ambient lighting, elegant furniture, rich dark tones. High-end feel that conveys exclusivity and trust.',
      ]
    }

    const systemPrompt = 'You are a video production expert. Generate exactly 3 creative, detailed scene descriptions for a celebrity advertisement video. Each description should cover environment, lighting, background, mood, and visual atmosphere in 1–2 sentences. Return ONLY a valid JSON array of 3 strings — no markdown, no explanation, just the array.'
    const userPrompt = `Celebrity: ${params.celebrityName}\nProduct type: ${params.productType}${params.purpose ? `\nPurpose: ${params.purpose}` : ''}${params.script ? `\nScript excerpt: ${params.script.slice(0, 200)}` : ''}\n\nGenerate 3 distinct scene descriptions.`

    const res = await fetch(`${OPENAI_BASE}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${openaiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        max_tokens: 800,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user',   content: userPrompt },
        ],
      }),
    })

    if (!res.ok) {
      const err = await res.text()
      throw new Error(`OpenAI API error (${res.status}): ${err}`)
    }

    const data = await res.json() as { choices?: Array<{ message: { content: string } }> }
    const content = data.choices?.[0]?.message?.content?.trim()
    if (!content) throw new Error('OpenAI returned empty response')

    const suggestions = JSON.parse(content) as string[]
    if (!Array.isArray(suggestions) || suggestions.length === 0) {
      throw new Error('Invalid suggestions format from OpenAI')
    }

    logger.info(`[AI] Generated ${suggestions.length} scene prompt suggestions`)
    return suggestions
  },

  /**
   * OpenAI — improves a celebrity video script using AI.
   * Falls back to returning the original script when the key is not set.
   */
  async improveScript(params: {
    script: string
    celebrityName: string
    productType: string
    purpose?: string
  }): Promise<string> {
    const { openaiKey } = await settingsService.get()
    if (!openaiKey) {
      logger.warn('[AI] OpenAI key not set — returning original script')
      return params.script
    }

    const systemPrompt = 'You are a professional copywriter specialising in celebrity video advertisements. Improve scripts to be more engaging, natural, and persuasive while preserving the core message. Return ONLY the improved script text with no preamble, explanation, or formatting marks.'
    const userPrompt = `Celebrity: ${params.celebrityName}\nProduct type: ${params.productType}${params.purpose ? `\nPurpose: ${params.purpose}` : ''}\n\nScript to improve:\n${params.script}`

    logger.info(`[AI] Improving script via OpenAI for celebrity=${params.celebrityName}`)
    const res = await fetch(`${OPENAI_BASE}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openaiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        max_tokens: 1024,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user',   content: userPrompt },
        ],
      }),
    })

    if (!res.ok) {
      const err = await res.text()
      throw new Error(`OpenAI API error (${res.status}): ${err}`)
    }

    const data = await res.json() as { choices?: Array<{ message: { content: string } }> }
    const improved = data.choices?.[0]?.message?.content?.trim()
    if (!improved) throw new Error('OpenAI returned empty response')

    logger.info('[AI] Script improved successfully')
    return improved
  },
}
