/**
 * Watermark Service — bakes a text watermark into a video using ffmpeg.
 *
 * Flow:
 *   1. Download source video into a temp file
 *   2. Generate a transparent watermark PNG from SVG via sharp (no system fonts needed in ffmpeg)
 *   3. Run ffmpeg overlay filter to composite the PNG onto the video
 *   4. Upload the result to S3
 *   5. Return the S3 URL (or the original URL if watermarking is unavailable)
 *
 * Settings consumed (from Settings DB):
 *   watermarkText     — displayed text, e.g. "twinity.ai · PREVIEW"
 *   watermarkOpacity  — 0.0–1.0
 *   watermarkPosition — "Bottom Center" | "Bottom Left" | "Bottom Right" |
 *                       "Top Left" | "Top Center" | "Top Right" | "Center"
 */
import ffmpeg from 'fluent-ffmpeg'
import sharp from 'sharp'
import { tmpdir } from 'os'
import { join } from 'path'
import { writeFile, unlink, readFile } from 'fs/promises'
import { randomUUID } from 'crypto'
import { IVideoJob } from '../models/VideoJob'
import { s3Service } from './s3.service'
import { settingsService } from './settings.service'
import { logger } from '../config/logger'

// Load ffmpeg binary path from @ffmpeg-installer/ffmpeg
const ffmpegBin: string = (require('@ffmpeg-installer/ffmpeg') as { path: string }).path
ffmpeg.setFfmpegPath(ffmpegBin)

// ── Watermark PNG builder ─────────────────────────────────────────────────────

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

async function buildWatermarkPng(text: string, opacity: number): Promise<Buffer> {
  const fontSize   = 22
  const lineHeight = fontSize + 10
  const padX       = 20
  const padY       = 12
  const lines      = text.split('\n')

  // Approximate character width for a proportional sans-serif font
  const approxCharWidth = fontSize * 0.56
  const maxLineLen      = Math.max(...lines.map(l => l.length))
  const width           = Math.ceil(maxLineLen * approxCharWidth) + padX * 2
  const height          = lines.length * lineHeight + padY * 2

  const svgLines = lines.map((line, i) => {
    const y = padY + (i + 1) * lineHeight - 4
    return [
      // Drop shadow pass
      `<text x="${padX + 1}" y="${y + 1}" font-family="Arial,Helvetica,sans-serif" font-size="${fontSize}"`,
      `  fill="black" fill-opacity="${Math.min(1, opacity * 0.7)}">${escapeXml(line)}</text>`,
      // Main text
      `<text x="${padX}" y="${y}" font-family="Arial,Helvetica,sans-serif" font-size="${fontSize}"`,
      `  fill="white" fill-opacity="${opacity}">${escapeXml(line)}</text>`,
    ].join('\n')
  }).join('\n')

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">\n${svgLines}\n</svg>`

  return sharp(Buffer.from(svg)).png().toBuffer()
}

// ── Position resolver ─────────────────────────────────────────────────────────
// ffmpeg overlay expression: W/H = video dims, w/h = watermark dims

function resolveOverlayXY(position: string): string {
  const map: Record<string, string> = {
    'Top Left':      '20:20',
    'Top Center':    '(W-w)/2:20',
    'Top Right':     'W-w-20:20',
    'Center':        '(W-w)/2:(H-h)/2',
    'Bottom Left':   '20:H-h-20',
    'Bottom Center': '(W-w)/2:H-h-20',
    'Bottom Right':  'W-w-20:H-h-20',
  }
  return map[position] ?? map['Bottom Center']
}

// ── Core watermarking ─────────────────────────────────────────────────────────

interface WatermarkResult {
  cleanUrl:       string  // S3 URL of the original video (no watermark) — used for download
  watermarkedUrl: string  // S3 URL of the watermarked video — used for preview
}

async function applyWatermark(videoUrl: string, referenceId: string): Promise<WatermarkResult> {
  const settings = await settingsService.get()
  const text     = settings.watermarkText     || 'twinity.ai · PREVIEW'
  const opacity  = Math.min(1, Math.max(0.05, parseFloat(settings.watermarkOpacity || '0.45')))
  const position = settings.watermarkPosition || 'Bottom Center'

  logger.info(`[Watermark] Starting: job=${referenceId}, position=${position}`)

  // Download source video once — reused for both the clean S3 copy and watermark input
  const videoRes = await fetch(videoUrl)
  if (!videoRes.ok) throw new Error(`Failed to download video for watermarking (HTTP ${videoRes.status})`)
  const videoBuffer = Buffer.from(await videoRes.arrayBuffer())

  const uid           = randomUUID()
  const inputPath     = join(tmpdir(), `tw-${uid}-in.mp4`)
  const watermarkPath = join(tmpdir(), `tw-${uid}-wm.png`)
  const outputPath    = join(tmpdir(), `tw-${uid}-out.mp4`)

  try {
    await writeFile(inputPath, videoBuffer)

    const wmBuffer = await buildWatermarkPng(text, opacity)
    await writeFile(watermarkPath, wmBuffer)

    const xy = resolveOverlayXY(position)

    await new Promise<void>((resolve, reject) => {
      ffmpeg(inputPath)
        .input(watermarkPath)
        .complexFilter([`[0:v][1:v]overlay=${xy}`])
        .outputOptions(['-c:a copy', '-movflags +faststart'])
        .save(outputPath)
        .on('end', () => resolve())
        .on('error', (err: Error) => reject(err))
    })

    const outBuffer    = await readFile(outputPath)
    const { s3Bucket } = await settingsService.get()

    // Upload both versions in parallel — we already have both buffers in memory
    const [cleanUpload, watermarkedUpload] = await Promise.all([
      s3Service.upload(s3Bucket, `jobs/${referenceId}/original.mp4`,           videoBuffer, 'video/mp4'),
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
      unlink(watermarkPath).catch(() => null),
      unlink(outputPath).catch(() => null),
    ])
  }
}

// ── Exported helper ───────────────────────────────────────────────────────────

/**
 * Apply a watermark to the Creatify video URL, update the job document,
 * and advance the job status to 'review'.
 *
 * On watermark failure the clean video URL is used as a fallback so the
 * job always moves forward — watermarking should never block delivery.
 */
export async function applyWatermarkAndAdvanceJob(job: IVideoJob, videoUrl: string): Promise<void> {
  let cleanUrl       = videoUrl  // fallback: Creatify URL if S3 upload fails
  let watermarkedUrl = videoUrl  // fallback: clean video if watermarking fails
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
