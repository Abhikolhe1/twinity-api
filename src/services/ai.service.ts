/**
 * AI Service — stubs for external AI API integrations.
 * Consumed by the AI Processing Pipeline (Python/FastAPI) via internal HTTP calls.
 * These stubs allow local testing and are replaced by real implementations in production.
 */
import { logger } from '../config/logger'
import { env } from '../config/env'

export interface VoiceCloneResult { jobId: string; audioUrl: string }
export interface LipSyncResult    { jobId: string; videoUrl: string }
export interface VideoRenderResult { jobId: string; videoUrl: string; watermarkedUrl: string }

export const aiService = {
  /**
   * ElevenLabs — clone celebrity voice and generate audio from script
   */
  async generateVoice(celebrityVoiceId: string, script: string): Promise<VoiceCloneResult> {
    logger.info(`[AI] ElevenLabs voice gen: celebrity=${celebrityVoiceId}`)

    if (!env.externalApis.elevenLabs) {
      logger.warn('[AI] ElevenLabs API key not set — returning stub')
      return { jobId: `stub-voice-${Date.now()}`, audioUrl: 'https://stub-audio.mp3' }
    }

    // Production:
    // const res = await fetch('https://api.elevenlabs.io/v1/text-to-speech/' + celebrityVoiceId, {
    //   method: 'POST',
    //   headers: { 'xi-api-key': env.externalApis.elevenLabs, 'Content-Type': 'application/json' },
    //   body: JSON.stringify({ text: script, model_id: 'eleven_multilingual_v2' }),
    // })
    // Upload audio to S3 and return URL

    return { jobId: `stub-voice-${Date.now()}`, audioUrl: 'https://stub-audio.mp3' }
  },

  /**
   * Sync Labs — lip-sync audio with celebrity avatar video
   */
  async lipSync(avatarVideoUrl: string, audioUrl: string): Promise<LipSyncResult> {
    logger.info(`[AI] SyncLabs lip-sync: avatar=${avatarVideoUrl}`)

    if (!env.externalApis.syncLabs) {
      logger.warn('[AI] SyncLabs API key not set — returning stub')
      return { jobId: `stub-lipsync-${Date.now()}`, videoUrl: 'https://stub-lipsync.mp4' }
    }

    // Production:
    // const res = await fetch('https://api.sync.so/v2/generate', {
    //   method: 'POST',
    //   headers: { 'x-api-key': env.externalApis.syncLabs, 'Content-Type': 'application/json' },
    //   body: JSON.stringify({ audioUrl, videoUrl: avatarVideoUrl }),
    // })
    // Poll for completion and return result URL

    return { jobId: `stub-lipsync-${Date.now()}`, videoUrl: 'https://stub-lipsync.mp4' }
  },

  /**
   * Higgsfield AI — full video rendering / digital twin generation
   */
  async renderVideo(params: { celebrityId: string; script: string; duration: string; aspectRatio: string }): Promise<VideoRenderResult> {
    logger.info(`[AI] Higgsfield render: celebrity=${params.celebrityId}, duration=${params.duration}`)

    if (!env.externalApis.higgsfield) {
      logger.warn('[AI] Higgsfield API key not set — returning stub')
      return {
        jobId: `stub-render-${Date.now()}`,
        videoUrl: 'https://stub-video.mp4',
        watermarkedUrl: 'https://stub-watermarked.mp4',
      }
    }

    // Production: call Higgsfield API, poll for result, apply watermark, upload to S3
    return {
      jobId: `stub-render-${Date.now()}`,
      videoUrl: 'https://stub-video.mp4',
      watermarkedUrl: 'https://stub-watermarked.mp4',
    }
  },
}
