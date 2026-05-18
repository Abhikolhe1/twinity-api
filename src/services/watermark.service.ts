/**
 * Watermark Service — bakes a text watermark into a video.
 *
 * Approach:
 *   1. sharp renders the watermark text into a transparent PNG (uses its own
 *      bundled libvips/librsvg — no system fonts required)
 *   2. ffmpeg overlays the PNG onto the video with explicit stream mapping
 *   3. Both the clean original and the watermarked copy are uploaded to S3
 *
 * Settings consumed (from Settings DB):
 *   watermarkText     — e.g. "twinity.ai PREVIEW"
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

// Bundled Inter Bold (700) — no system fonts required on the server
const FONT_PATH = join(__dirname, '../../node_modules/@fontsource/inter/files/inter-latin-700-normal.woff2')
let _fontBase64: string | null = null
async function getFontBase64(): Promise<string> {
  if (!_fontBase64) {
    const buf = await readFile(FONT_PATH)
    _fontBase64 = buf.toString('base64')
  }
  return _fontBase64
}

const ffmpegBin: string = (require('@ffmpeg-installer/ffmpeg') as { path: string }).path
ffmpeg.setFfmpegPath(ffmpegBin)

// ── Watermark PNG ─────────────────────────────────────────────────────────────

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

async function buildWatermarkPng(text: string, opacity: number): Promise<Buffer> {
  const fontSize   = 24
  const lineHeight = fontSize + 12
  const padX       = 20
  const padY       = 12
  const lines      = text.split('\n')
  const maxLen     = Math.max(...lines.map(l => l.length))
  const width      = Math.ceil(maxLen * fontSize * 0.58) + padX * 2 + 20
  const height     = lines.length * lineHeight + padY * 2

  const fontBase64 = await getFontBase64()

  const svgLines = lines.map((line, i) => {
    const y = padY + (i + 1) * lineHeight - 4
    return [
      `<text x="${padX + 1}" y="${y + 1}" font-family="Inter" font-size="${fontSize}"`,
      `  font-weight="bold" fill="black" fill-opacity="${(opacity * 0.6).toFixed(2)}">${escapeXml(line)}</text>`,
      `<text x="${padX}" y="${y}" font-family="Inter" font-size="${fontSize}"`,
      `  font-weight="bold" fill="white" fill-opacity="${opacity.toFixed(2)}">${escapeXml(line)}</text>`,
    ].join('\n')
  }).join('\n')

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
  <defs>
    <style>
      @font-face {
        font-family: 'Inter';
        font-weight: 700;
        src: url('data:font/woff2;base64,${fontBase64}') format('woff2');
      }
    </style>
  </defs>
  ${svgLines}
</svg>`

  return sharp(Buffer.from(svg)).png().toBuffer()
}

// ── Position → ffmpeg overlay expression ─────────────────────────────────────
// W/H = video dims, w/h = watermark dims

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
  cleanUrl:       string
  watermarkedUrl: string
}

async function applyWatermark(videoUrl: string, referenceId: string): Promise<WatermarkResult> {
  const settings = await settingsService.get()
  const text     = settings.watermarkText     || 'twinity.ai PREVIEW'
  const opacity  = Math.min(1, Math.max(0.1, parseFloat(settings.watermarkOpacity || '0.45')))
  const position = settings.watermarkPosition || 'Bottom Center'

  logger.info(`[Watermark] Starting: job=${referenceId}, position=${position}`)

  const videoRes = await fetch(videoUrl)
  if (!videoRes.ok) throw new Error(`Failed to download video (HTTP ${videoRes.status})`)
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
        // Label the overlaid stream [vout] and map it explicitly.
        // Without the label + -map, ffmpeg may write the original stream unchanged.
        .complexFilter([`[0:v][1:v]overlay=${xy}[vout]`])
        .outputOptions([
          '-map [vout]',
          '-map 0:a?',       // include audio if present (? = optional)
          '-c:a copy',
          '-movflags +faststart',
        ])
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
      unlink(watermarkPath).catch(() => null),
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
