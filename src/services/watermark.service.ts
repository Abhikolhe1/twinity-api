/**
 * Watermark Service — bakes a text watermark into a video using ffmpeg drawtext.
 *
 * Uses ffmpeg's built-in drawtext filter (no external font file required).
 * A semi-transparent background box is drawn behind the text so it is legible
 * on both dark and light video content.
 *
 * Settings consumed (from Settings DB):
 *   watermarkText     — displayed text, e.g. "twinity.ai PREVIEW"
 *   watermarkOpacity  — 0.0–1.0
 *   watermarkPosition — "Bottom Center" | "Bottom Left" | "Bottom Right" |
 *                       "Top Left" | "Top Center" | "Top Right" | "Center"
 */
import ffmpeg from 'fluent-ffmpeg'
import { tmpdir } from 'os'
import { join } from 'path'
import { writeFile, unlink, readFile } from 'fs/promises'
import { randomUUID } from 'crypto'
import { IVideoJob } from '../models/VideoJob'
import { s3Service } from './s3.service'
import { settingsService } from './settings.service'
import { logger } from '../config/logger'

const ffmpegBin: string = (require('@ffmpeg-installer/ffmpeg') as { path: string }).path
ffmpeg.setFfmpegPath(ffmpegBin)

// ── Text sanitiser ────────────────────────────────────────────────────────────
// ffmpeg drawtext has a strict escaping requirement.
// Replace non-ASCII glyphs (e.g. ·) with ASCII equivalents before passing.
function sanitiseForDrawtext(text: string): string {
  return text
    .replace(/·/g, '-')          // middle dot → hyphen
    .replace(/[^\x20-\x7E]/g, '') // strip any remaining non-printable / non-ASCII
    .replace(/'/g, '')            // remove apostrophes (hard to escape safely)
    .replace(/:/g, '\\:')         // colon must be escaped in drawtext value
    .replace(/\\/g, '\\\\')       // backslash must be doubled
    .trim()
}

// ── Position → drawtext x/y ───────────────────────────────────────────────────
function resolveXY(position: string): { x: string; y: string } {
  const map: Record<string, { x: string; y: string }> = {
    'Top Left':      { x: '20',              y: '20'           },
    'Top Center':    { x: '(w-text_w)/2',    y: '20'           },
    'Top Right':     { x: 'w-text_w-20',     y: '20'           },
    'Center':        { x: '(w-text_w)/2',    y: '(h-text_h)/2' },
    'Bottom Left':   { x: '20',              y: 'h-text_h-20'  },
    'Bottom Center': { x: '(w-text_w)/2',    y: 'h-text_h-20'  },
    'Bottom Right':  { x: 'w-text_w-20',     y: 'h-text_h-20'  },
  }
  return map[position] ?? map['Bottom Center']
}

// ── Core watermarking ─────────────────────────────────────────────────────────

interface WatermarkResult {
  cleanUrl:       string
  watermarkedUrl: string
}

async function applyWatermark(videoUrl: string, referenceId: string): Promise<WatermarkResult> {
  const settings = await settingsService.get()
  const rawText  = settings.watermarkText     || 'twinity.ai PREVIEW'
  const opacity  = Math.min(1, Math.max(0.1, parseFloat(settings.watermarkOpacity || '0.45')))
  const position = settings.watermarkPosition || 'Bottom Center'

  const text = sanitiseForDrawtext(rawText)
  const { x, y } = resolveXY(position)
  const boxOpacity = Math.min(1, opacity * 0.8)

  // Build the drawtext filter string
  const drawtextFilter = [
    `drawtext=text='${text}'`,
    `fontsize=28`,
    `fontcolor=white@${opacity.toFixed(2)}`,
    `x=${x}`,
    `y=${y}`,
    `box=1`,
    `boxcolor=black@${boxOpacity.toFixed(2)}`,
    `boxborderw=10`,
  ].join(':')

  logger.info(`[Watermark] Starting: job=${referenceId}, position=${position}`)

  const videoRes = await fetch(videoUrl)
  if (!videoRes.ok) throw new Error(`Failed to download video for watermarking (HTTP ${videoRes.status})`)
  const videoBuffer = Buffer.from(await videoRes.arrayBuffer())

  const uid        = randomUUID()
  const inputPath  = join(tmpdir(), `tw-${uid}-in.mp4`)
  const outputPath = join(tmpdir(), `tw-${uid}-out.mp4`)

  try {
    await writeFile(inputPath, videoBuffer)

    await new Promise<void>((resolve, reject) => {
      ffmpeg(inputPath)
        .videoFilter(drawtextFilter)
        .outputOptions(['-c:a copy', '-movflags +faststart'])
        .save(outputPath)
        .on('end', () => resolve())
        .on('error', (err: Error) => reject(err))
    })

    const outBuffer    = await readFile(outputPath)
    const { s3Bucket } = await settingsService.get()

    const [cleanUpload, watermarkedUpload] = await Promise.all([
      s3Service.upload(s3Bucket, `jobs/${referenceId}/original.mp4`,            videoBuffer, 'video/mp4'),
      s3Service.upload(s3Bucket, `jobs/${referenceId}/preview-watermarked.mp4`, outBuffer,   'video/mp4'),
    ])

    const [cleanUrl, watermarkedUrl] = await Promise.all([
      cleanUpload.stub       ? cleanUpload.url       : s3Service.getPresignedUrl(s3Bucket, cleanUpload.key),
      watermarkedUpload.stub ? watermarkedUpload.url : s3Service.getPresignedUrl(s3Bucket, watermarkedUpload.key),
    ])

    logger.info(`[Watermark] Done: job=${referenceId}`)
    return { cleanUrl, watermarkedUrl }
  } finally {
    await Promise.all([
      unlink(inputPath).catch(() => null),
      unlink(outputPath).catch(() => null),
    ])
  }
}

// ── Exported helper ───────────────────────────────────────────────────────────

export async function applyWatermarkAndAdvanceJob(job: IVideoJob, videoUrl: string): Promise<void> {
  let cleanUrl       = videoUrl
  let watermarkedUrl = videoUrl
  try {
    const result = await applyWatermark(videoUrl, job.referenceId)
    cleanUrl       = result.cleanUrl
    watermarkedUrl = result.watermarkedUrl
  } catch (err) {
    logger.error(`[Watermark] Failed for job ${job.referenceId} — using Creatify URL as fallback:`, err)
  }

  job.finalVideoUrl  = cleanUrl
  job.watermarkedUrl = watermarkedUrl
  job.previewUrl     = watermarkedUrl
  job.status         = 'review'
  job.statusHistory.push({
    status:    'review',
    timestamp: new Date(),
    note:      'Creatify Aurora complete — pending CS review',
  })
  await job.save()
}
