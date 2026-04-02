/**
 * AI Service — integrates ElevenLabs (TTS voice) and HeyGen (talking photo lip-sync).
 * API keys are loaded dynamically from the Settings DB (via settingsService).
 *
 * Pipeline:
 *   1. generateVoice() — ElevenLabs TTS using celebrity's cloned voiceModelId → MP3
 *   2. heygenLipSync() — HeyGen Talking Photo: celebrity image + MP3 → lip-synced video
 *
 * HeyGen Talking Photo workflow:
 *   - First use: upload celebrity image → get talking_photo_id (saved on Celebrity document)
 *   - Subsequent uses: talking_photo_id reused from Celebrity.heygenPhotoId
 *   - Video generation is async; completion is delivered via HeyGen webhook
 *
 * All methods fall back to stubs when credentials are not configured.
 */
import FormDataLib from 'form-data'
import { logger } from '../config/logger'
import { settingsService } from './settings.service'
import { s3Service } from './s3.service'

export interface VoiceCloneResult     { jobId: string; audioUrl: string }
export interface VoiceCloneIdResult   { voiceId: string }
export interface HeyGenResult         { requestId: string; status: 'submitted' | 'training' | 'stub'; photoId?: string }

// ─── HeyGen API ───────────────────────────────────────────────────────────────
const HEYGEN_BASE = 'https://api.heygen.com'

function heygenDimension(aspectRatio: string): { width: string; height: string } {
  if (aspectRatio === '9:16') return { width: '720',  height: '1280' }
  if (aspectRatio === '1:1')  return { width: '720',  height: '720'  }
  if (aspectRatio === '4:5')  return { width: '576',  height: '720'  }
  return { width: '1280', height: '720' } // 16:9 default
}

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
    // Generate a pre-signed URL so HeyGen can download the private S3 object.
    // Valid for 2 hours — enough time for HeyGen to process the job.
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
   * HeyGen — lip-sync a celebrity's talking photo with generated audio.
   *
   * Steps:
   *   1. If heygenPhotoId is not cached, upload the celebrity's image to HeyGen
   *      to create a Talking Photo and get a talking_photo_id.
   *   2. Submit a video generation job using talking_photo_id + audioUrl.
   *   3. Return the video_id; job completion fires a HeyGen webhook.
   *
   * Returns { photoId } so the caller can cache it on the Celebrity document.
   */
  async heygenLipSync(params: {
    audioUrl: string
    imageUrl: string
    heygenPhotoId?: string
    aspectRatio: string
    referenceId: string
    script: string
  }): Promise<HeyGenResult> {
    logger.info(`[AI] HeyGen lip-sync: refId=${params.referenceId}`)
    const { heygenKey } = await settingsService.get()

    if (!heygenKey) {
      logger.warn('[AI] HeyGen key not set — returning stub')
      return { requestId: `stub-heygen-${Date.now()}`, status: 'stub' }
    }

    if (!params.audioUrl) {
      logger.warn('[AI] HeyGen: no audioUrl — returning stub')
      return { requestId: `stub-heygen-${Date.now()}`, status: 'stub' }
    }

    // Upload celebrity image to HeyGen asset storage and create a photo avatar group.
    // Returns immediately — training completion is delivered via webhook.
    const uploadPhoto = async (): Promise<string> => {
      logger.info(`[AI] HeyGen: imageUrl=${params.imageUrl || '(empty)'}`)
      if (!params.imageUrl) throw new Error('HeyGen: celebrity has no thumbnailUrl — upload a photo in the admin panel')
      if (params.imageUrl.startsWith('data:')) throw new Error('HeyGen: celebrity thumbnailUrl is a base64 data URL — save the celebrity again to upload to S3')

      logger.info(`[AI] HeyGen: fetching celebrity image from ${params.imageUrl}`)
      const imgRes = await fetch(params.imageUrl)
      if (!imgRes.ok) throw new Error(`Failed to fetch celebrity image (${imgRes.status})`)
      const imgBuffer = await imgRes.arrayBuffer()

      const ext = params.imageUrl.split('?')[0].split('.').pop()?.toLowerCase() || 'jpg'
      const contentType = ext === 'png' ? 'image/png' : 'image/jpeg'

      logger.info(`[AI] HeyGen: uploading image asset (${contentType}, ${imgBuffer.byteLength} bytes)`)
      const assetRes = await fetch('https://upload.heygen.com/v1/asset', {
        method: 'POST',
        headers: { 'X-Api-Key': heygenKey, 'Content-Type': contentType },
        body: imgBuffer,
      })
      if (!assetRes.ok) {
        const err = await assetRes.text()
        throw new Error(`HeyGen asset upload failed (${assetRes.status}): ${err}`)
      }
      const assetData = await assetRes.json() as { code?: number; data?: { id: string; image_key: string } }
      const imageKey = assetData.data?.image_key
      if (!imageKey) throw new Error(`HeyGen asset upload: no image_key in response: ${JSON.stringify(assetData)}`)
      logger.info(`[AI] HeyGen: image asset uploaded, image_key=${imageKey}`)

      const groupRes = await fetch(`${HEYGEN_BASE}/v2/photo_avatar/avatar_group/create`, {
        method: 'POST',
        headers: { 'X-Api-Key': heygenKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: `twinity-${Date.now()}`, image_key: imageKey }),
      })
      if (!groupRes.ok) {
        const err = await groupRes.text()
        throw new Error(`HeyGen avatar group create failed (${groupRes.status}): ${err}`)
      }
      const groupData = await groupRes.json() as { data?: { group_id: string } }
      const groupId = groupData.data?.group_id
      if (!groupId) throw new Error(`HeyGen avatar group: no group_id in response: ${JSON.stringify(groupData)}`)
      logger.info(`[AI] HeyGen photo avatar group created: group_id=${groupId} — awaiting training webhook`)
      return groupId
    }

    // No cached photoId — upload image and wait for training webhook before video generation
    if (!params.heygenPhotoId) {
      const groupId = await uploadPhoto()
      return { requestId: groupId, status: 'training', photoId: groupId }
    }

    // Have cached photoId — submit video generation directly
    const videoData = await aiService.submitHeyGenVideo({
      audioUrl:    params.audioUrl,
      photoId:     params.heygenPhotoId,
      aspectRatio: params.aspectRatio,
      referenceId: params.referenceId,
      script:      params.script,
      heygenKey,
    })

    // Stale cached photo — re-upload and let training webhook trigger video generation
    if (videoData.stale) {
      logger.warn(`[AI] HeyGen: cached photoId=${params.heygenPhotoId} is stale — re-uploading`)
      const groupId = await uploadPhoto()
      return { requestId: groupId, status: 'training', photoId: groupId }
    }

    logger.info(`[AI] HeyGen video generation queued: video_id=${videoData.videoId}`)
    return { requestId: videoData.videoId, status: 'submitted', photoId: params.heygenPhotoId }
  },

  /**
   * Submit a HeyGen video generation job for an already-trained photo avatar.
   * Called both from heygenLipSync (cached photoId path) and from the webhook
   * handler when avatar training completes.
   */
  async submitHeyGenVideo(params: {
    audioUrl: string
    photoId: string
    aspectRatio: string
    referenceId: string
    script: string
    heygenKey?: string
  }): Promise<{ videoId: string; stale: boolean }> {
    const heygenKey = params.heygenKey ?? (await settingsService.get()).heygenKey
    if (!heygenKey) throw new Error('HeyGen API key not configured')

    logger.info(`[AI] HeyGen submitVideo: refId=${params.referenceId}, photoId=${params.photoId}, script="${params.script.slice(0, 80)}..."`)

    const dimension = heygenDimension(params.aspectRatio)
    const videoRes = await fetch(`${HEYGEN_BASE}/v2/video/generate`, {
      method: 'POST',
      headers: { 'X-Api-Key': heygenKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: params.script.slice(0, 200),
        caption: false,
        video_inputs: [{
          character: { type: 'talking_photo', talking_photo_id: params.photoId },
          voice:     { type: 'audio', audio_url: params.audioUrl },
        }],
        dimension,
        callback_id: params.referenceId,
      }),
    })
    if (!videoRes.ok) {
      const err = await videoRes.text()
      throw new Error(`HeyGen video generate failed (${videoRes.status}): ${err}`)
    }
    const videoData = await videoRes.json() as {
      error?: { code?: string; message?: string } | string
      data?: { video_id: string }
    }
    const errMsg = typeof videoData.error === 'object' ? videoData.error?.message : videoData.error
    if (videoData.error && typeof errMsg === 'string' && errMsg.includes('missing image dimensions')) {
      return { videoId: '', stale: true }
    }
    if (videoData.error) throw new Error(`HeyGen video generate error: ${errMsg}`)

    return { videoId: videoData.data!.video_id, stale: false }
  },

  /**
   * Claude API — improves a celebrity video script using AI.
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
