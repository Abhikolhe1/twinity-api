/**
 * AI Service — integrates ElevenLabs (TTS voice) and Creatify Aurora (lip-sync video).
 * API keys are loaded dynamically from the Settings DB (via settingsService).
 *
 * Pipeline:
 *   1. generateVoice()   — ElevenLabs TTS using celebrity's cloned voiceModelId → MP3
 *   2. creatifyAurora()  — Creatify Aurora: celebrity image + MP3 → lip-synced video (async)
 *
 * All methods fall back to stubs when credentials are not configured.
 */
import FormDataLib from 'form-data'
import { logger } from '../config/logger'
import { settingsService } from './settings.service'
import { s3Service } from './s3.service'

export interface VoiceCloneResult   { jobId: string; audioUrl: string; durationSecs: number }
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
      body: JSON.stringify({ text: sampleText, model_id: 'eleven_v3' }),
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

// ─── Creatify API ─────────────────────────────────────────────────────────────
const CREATIFY_BASE = 'https://api.creatify.ai'

export interface CreatifyResult { jobId: string; status: 'submitted' | 'stub' }

// ─── OpenAI API ───────────────────────────────────────────────────────────────
const OPENAI_BASE = 'https://api.openai.com'

// ─── Language detector ────────────────────────────────────────────────────────
// Returns an ISO 639-1 code based on Unicode character ranges in the text.
// Arabic (0600–06FF) > 30 % of non-whitespace chars → "ar", else → "en".
// Extend the map below to support additional scripts as needed.
const SCRIPT_PATTERNS: Array<{ re: RegExp; code: string }> = [
  { re: /[\u0600-\u06FF]/g, code: 'ar' },  // Arabic
  { re: /[\u0400-\u04FF]/g, code: 'ru' },  // Cyrillic
  { re: /[\u4E00-\u9FFF]/g, code: 'zh' },  // CJK (Chinese)
  { re: /[\u3040-\u30FF]/g, code: 'ja' },  // Hiragana / Katakana
  { re: /[\uAC00-\uD7AF]/g, code: 'ko' },  // Korean Hangul
  { re: /[\u0900-\u097F]/g, code: 'hi' },  // Devanagari (Hindi)
]

function detectLanguage(text: string): string {
  const total = text.replace(/\s/g, '').length
  if (total === 0) return 'en'
  for (const { re, code } of SCRIPT_PATTERNS) {
    const count = (text.match(re) ?? []).length
    if (count / total > 0.3) return code
  }
  return 'en'
}

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
      return { jobId: `stub-voice-${Date.now()}`, audioUrl: 'https://stub-audio.mp3', durationSecs: 30 }
    }

    // Request raw PCM so we can pad silence in pure Node.js (no ffmpeg needed)
    const SAMPLE_RATE = 22050
    const CHANNELS    = 1
    const BIT_DEPTH   = 16

    const detectedLang = detectLanguage(script)
    logger.info(`[AI] Detected script language: ${detectedLang}`)

    const res = await fetch(
      `${ELEVENLABS_BASE}/text-to-speech/${celebrityVoiceId}/with-timestamps?output_format=pcm_22050`,
      {
        method:  'POST',
        headers: { 'xi-api-key': elevenLabsKey, 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          text:          script,
          model_id:      'eleven_v3',
          language_code: detectedLang
        }),
      },
    )
    if (!res.ok) throw new Error(`ElevenLabs failed (${res.status})`)

    const data = await res.json() as {
      audio_base64: string
      alignment: { character_end_times_seconds: number[] }
    }

    const pcmData  = Buffer.from(data.audio_base64, 'base64')
    const endTimes = data.alignment?.character_end_times_seconds ?? []
    const speechSecs = endTimes.length > 0 ? Math.ceil(endTimes[endTimes.length - 1]) : 30

    // Wrap PCM in a standard WAV container
    const dataSize  = pcmData.length
    const byteRate  = SAMPLE_RATE * CHANNELS * (BIT_DEPTH / 8)
    const wavHeader = Buffer.alloc(44)
    wavHeader.write('RIFF', 0)
    wavHeader.writeUInt32LE(36 + dataSize, 4)
    wavHeader.write('WAVE', 8)
    wavHeader.write('fmt ', 12)
    wavHeader.writeUInt32LE(16, 16)
    wavHeader.writeUInt16LE(1, 20)                            // PCM
    wavHeader.writeUInt16LE(CHANNELS, 22)
    wavHeader.writeUInt32LE(SAMPLE_RATE, 24)
    wavHeader.writeUInt32LE(byteRate, 28)
    wavHeader.writeUInt16LE(CHANNELS * (BIT_DEPTH / 8), 32)  // block align
    wavHeader.writeUInt16LE(BIT_DEPTH, 34)
    wavHeader.write('data', 36)
    wavHeader.writeUInt32LE(dataSize, 40)
    const audioBuffer = Buffer.concat([wavHeader, pcmData])

    const durationSecs = speechSecs
    logger.info(`[AI] ElevenLabs audio: speech=${speechSecs}s`)

    const jobId = `el-${Date.now()}`
    const { s3Bucket } = await settingsService.get()
    const key    = `celebrities/${celebSlug}/generated-audio/${jobId}.wav`
    const upload = await s3Service.upload(s3Bucket, key, audioBuffer, 'audio/wav')
    const audioUrl = upload.stub
      ? upload.url
      : await s3Service.getPresignedUrl(s3Bucket, upload.key, 7200)

    logger.info(`[AI] ElevenLabs audio uploaded: ${upload.url}`)
    return { jobId, audioUrl, durationSecs }
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
   * Creatify Aurora — generate a lip-synced avatar video from a celebrity image + audio.
   * Single step: replaces both Higgsfield (video gen) and Sync.so (lip-sync).
   * Completion delivered via POST {SERVER_URL}/api/webhooks/creatify (or polled).
   *
   * Auth: X-API-ID + X-API-KEY headers
   * POST https://api.creatify.ai/api/aurora/
   */
  async creatifyAurora(params: {
    audioUrl: string
    imageUrl: string
    referenceId: string
    callbackUrl?: string
    creatifyPrompt?: string
    backgroundImageUrl?: string
  }): Promise<CreatifyResult> {
    const { creatifyApiId, creatifyApiKey } = await settingsService.get()

    if (!creatifyApiId || !creatifyApiKey) {
      logger.warn('[AI] Creatify API ID / key not set — returning stub')
      return { jobId: `stub-creatify-${Date.now()}`, status: 'stub' }
    }

    if (!params.imageUrl) throw new Error('Creatify Aurora: imageUrl is empty — upload a photo for this celebrity in the admin panel')
    if (!params.audioUrl) throw new Error('Creatify Aurora: audioUrl is empty — ElevenLabs audio URL not available')

    const textPrompt = params.creatifyPrompt?.trim() ?? ''

    logger.info(`[AI] Creatify Background Image: ${params.backgroundImageUrl}`)

    return fetch(`${CREATIFY_BASE}/api/aurora/`, {
      method: 'POST',
      headers: {
        'X-API-ID':     creatifyApiId,
        'X-API-KEY':    creatifyApiKey,
        'Content-Type': 'application/json',
        'Accept':       '*/*',
        'User-Agent':   'PostmanRuntime/7.53.0',
      },
      body: JSON.stringify({
        audio:                 params.audioUrl,
        image:                 params.backgroundImageUrl ?? params.imageUrl,
        name:                  params.referenceId,
        text_prompt:           textPrompt,
        prompt_guidance_scale: 1,
        model_version:         'aurora_v1',
        webhook_url:           params.callbackUrl,
      }),
    })
      .then(async res => {
        const text = await res.text()
        if (!text) throw new Error(`Creatify Aurora (${res.status}): empty response body`)
        const data = JSON.parse(text) as { id?: string; status?: string }
        if (!data.id) throw new Error(`Creatify Aurora: no id in response: ${text}`)
        logger.info(`[AI] Creatify Aurora job submitted: id=${data.id}`)
        return { jobId: data.id, status: 'submitted' as const }
      })
      .catch((err: unknown) => {
        logger.error('[AI] Creatify Aurora error:', err)
        throw err
      })
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

    const systemPrompt = 'You are a professional copywriter specialising in celebrity video advertisements. Improve scripts to be more engaging, natural, and persuasive while preserving the core message. CRITICAL: the output MUST be 40 words or fewer — this is a hard limit imposed by the video generation platform. Count every word carefully before responding. Return ONLY the improved script text with no preamble, explanation, or formatting marks.'
    const userPrompt = `Celebrity: ${params.celebrityName}\nProduct type: ${params.productType}${params.purpose ? `\nPurpose: ${params.purpose}` : ''}\n\nScript to improve (must stay within 40 words):\n${params.script}`

    logger.info(`[AI] Improving script via OpenAI for celebrity=${params.celebrityName}`)
    const res = await fetch(`${OPENAI_BASE}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openaiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        max_tokens: 60,
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

    // Hard-enforce 25-word limit as a safety net in case the model goes over
    const words = improved.split(/\s+/)
    const result = words.length > 40 ? words.slice(0, 40).join(' ') : improved

    if (words.length > 40) {
      logger.warn(`[AI] Improved script exceeded 40 words (${words.length}) — trimmed`)
    }

    logger.info('[AI] Script improved successfully')
    return result
  },

  /**
   * OpenAI GPT-4o — enhances an Arabic script with prosody markers for ElevenLabs v3 TTS.
   * Adds pauses, audio tags, and line breaks for natural spoken delivery without
   * changing any original words. Falls back to the original script when key is not set.
   */
  async enhanceScriptForTTS(script: string): Promise<string> {
    const { openaiKey } = await settingsService.get()
    if (!openaiKey) {
      logger.warn('[AI] OpenAI key not set — skipping TTS prosody enhancement')
      return script
    }

    const systemPrompt = `You are an expert Arabic speech prosody optimizer for AI voice generation using ElevenLabs (v3).

Your PRIMARY GOAL is to enhance the given Arabic script for highly natural, human-like spoken delivery by adding audio tags, pauses, and emphasis — WITHOUT changing the original wording or meaning.

STRICT RULES:

1. DO NOT change, rewrite, paraphrase, or remove any words.
2. DO NOT add any new words or claims.
3. Preserve all original Arabic text, brand names, and structure EXACTLY.
4. You are ONLY allowed to enhance delivery using:

   * audio tags
   * pauses
   * line breaks
   * punctuation emphasis

---

## ALLOWED ENHANCEMENTS

You may ONLY:

• Add audio tags in square brackets [] (must describe voice only)
• Add pauses using:

* "..." (natural pause)
* [short pause], [long pause] (sparingly)
  • Insert line breaks for better speech rhythm
  • Add emphasis using:
* capitalization (very minimal)
* question marks / exclamation marks
* ellipses "..."

---

## PRIMARY OBJECTIVES

1. Make the script sound like a real human (celebrity / influencer style)
2. Improve rhythm, pacing, and clarity
3. Ensure natural Saudi-style conversational delivery (NOT formal or robotic)

---

## KEY OPTIMIZATION RULES

### 1. Context Awareness

* Understand if the script is:
  • greeting
  • advertisement
  • recommendation
* Adjust tone subtly (ads = engaging, greetings = softer)

---

### 2. Brand / Name Handling (CRITICAL)

* ALWAYS add a slight pause before or after brand/product names
* If needed, isolate brand names using pauses:
  e.g. "... نوفا ..."
* Ensure clean pronunciation flow, especially for mixed Arabic-English names

---

### 3. Pause Strategy (MOST IMPORTANT)

* Add pauses at:
  • at brand or any other names
  • emphasis points (ONLY WHEN REQUIRED)
  • before CTA
* Use pauses naturally — DO NOT overuse

---

### 4. Audio Tag Usage (VERY CONTROLLED)

* Use MAXIMUM 1–2 audio tags per script
* Tags must describe voice only (tone or subtle non-verbal)

Preferred tags:

* Opening → [curious] or [soft]
* CTA → [confident]
* Optional → [sighs], [chuckles] (ONLY if natural)

DO NOT:

* overuse tags
* add dramatic or theatrical tags
* contradict meaning

---

### 5. Sentence Flow

* Break long sentences into shorter spoken lines only if sentence is longer than 6-8 words
* Maintain natural breathing rhythm
* Keep conversational flow

---

### 6. Mixed Language Handling

* When Arabic + English words appear:
  • add slight pause before switching if needed

---

### 7. Avoid Overacting

* Keep delivery subtle, believable, and natural
* PRIORITIZE:
  pause > rhythm > minimal tags

---

## OUTPUT FORMAT

* Multi-line script
* Clean spacing
* Natural conversational rhythm
* Audio tags in []
* No explanations
* No extra text

Return ONLY the enhanced script ready for direct TTS input.`

    logger.info('[AI] Enhancing script prosody via GPT-4o')
    const res = await fetch(`${OPENAI_BASE}/v1/chat/completions`, {
      method:  'POST',
      headers: { 'Authorization': `Bearer ${openaiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model:      'gpt-4o',
        max_tokens: 500,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user',   content: script },
        ],
      }),
    })

    if (!res.ok) {
      const err = await res.text()
      logger.warn(`[AI] GPT-4o prosody enhancement failed (${res.status}): ${err} — using original script`)
      return script
    }

    const data     = await res.json() as { choices?: Array<{ message: { content: string } }> }
    const enhanced = data.choices?.[0]?.message?.content?.trim()
    if (!enhanced) {
      logger.warn('[AI] GPT-4o returned empty prosody response — using original script')
      return script
    }

    logger.info('[AI] Script prosody enhanced successfully')
    return enhanced
  },
}
