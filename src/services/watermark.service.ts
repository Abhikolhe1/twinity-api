/**
 * Watermark Service — bakes a watermark into a video.
 *
 * Mode A (image): when watermarkImageUrl is set in Settings, downloads the
 *   image and composites it via ffmpeg overlay filter at the configured position.
 *
 * Mode B (text fallback): uses ffmpeg drawtext filter when no image is configured.
 *
 * Settings consumed (from Settings DB):
 *   watermarkImageUrl — URL of the watermark PNG/JPG (Mode A)
 *   watermarkText     — e.g. "twinity.ai PREVIEW" (Mode B fallback)
 *   watermarkOpacity  — 0.0–1.0
 *   watermarkPosition — "Bottom Center" | "Bottom Left" | "Bottom Right" |
 *                       "Top Left" | "Top Center" | "Top Right" | "Center"
 */
import ffmpeg from 'fluent-ffmpeg'
import { tmpdir } from 'os'
import { join } from 'path'
import { writeFile, unlink, readFile } from 'fs/promises'
import { randomUUID } from 'crypto'

interface IVideoJob {
  referenceId: string
  finalVideoUrl: string
  watermarkedUrl: string
  previewUrl: string
  status: string
  statusHistory: unknown[]
  save(): Promise<void>
}

import { s3Service } from './s3.service'
import { settingsService } from './settings.service'
import { logger } from '../config/logger'

interface FontResult { path: string; cssFamily: string; dir: string }
let _font: FontResult | null | false = undefined as any // undefined = not probed yet

const FONT_CANDIDATES: Array<{ path: string; cssFamily: string; dir: string }> = [
  // Linux (install with: apt-get install -y fonts-liberation)
  { path: '/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf', cssFamily: 'Liberation Sans', dir: '/usr/share/fonts/truetype/liberation' },
  { path: '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',                 cssFamily: 'DejaVu Sans',      dir: '/usr/share/fonts/truetype/dejavu' },
  { path: '/usr/share/fonts/truetype/ubuntu/Ubuntu-R.ttf',                   cssFamily: 'Ubuntu',           dir: '/usr/share/fonts/truetype/ubuntu' },
  { path: '/usr/share/fonts/truetype/freefont/FreeSans.ttf',                 cssFamily: 'FreeSans',         dir: '/usr/share/fonts/truetype/freefont' },
  { path: '/usr/share/fonts/truetype/msttcorefonts/Arial.ttf',               cssFamily: 'Arial',            dir: '/usr/share/fonts/truetype/msttcorefonts' },
  // Windows (local dev)
  { path: 'C:/Windows/Fonts/arial.ttf',    cssFamily: 'Arial',    dir: 'C:/Windows/Fonts' },
  { path: 'C:/Windows/Fonts/calibri.ttf',  cssFamily: 'Calibri',  dir: 'C:/Windows/Fonts' },
  { path: 'C:/Windows/Fonts/verdana.ttf',  cssFamily: 'Verdana',  dir: 'C:/Windows/Fonts' },
  { path: 'C:/Windows/Fonts/segoeui.ttf',  cssFamily: 'Segoe UI', dir: 'C:/Windows/Fonts' },
]

async function getFont(): Promise<FontResult | null> {
  if (_font !== (undefined as any)) return _font as FontResult | null
  for (const candidate of FONT_CANDIDATES) {
    try {
      await readFile(candidate.path)
      _font = candidate
      logger.info(`[Watermark] Font selected: ${candidate.cssFamily} (${candidate.path})`)
      return _font
    } catch { /* try next */ }
  }
  logger.warn('[Watermark] No TTF font found — drawtext will rely on ffmpeg default. Install fonts-liberation on the server.')
  _font = null
  return null
}

const ffmpegBin: string = (require('@ffmpeg-installer/ffmpeg') as { path: string }).path
ffmpeg.setFfmpegPath(ffmpegBin)

// ── drawtext helpers ──────────────────────────────────────────────────────────

function escapeDrawtext(s: string): string {
  // ffmpeg drawtext special characters that must be escaped
  return s
    .replace(/\\/g, '\\\\')
    .replace(/'/g, '')        // drop single-quotes; they cannot be safely nested
    .replace(/:/g,  '\\:')
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]')
    .replace(/,/g,  '\\,')
    .replace(/%/g,  '\\%')
}

function buildDrawtextFilter(text: string, opacity: number, position: string, fontPath: string | null): string {
  const fontSize   = 28
  const lineHeight = fontSize + 8   // ~36 px per line
  const pad        = 24
  const lines      = text.split('\n')
  const nLines     = lines.length

  // Forward-slashes required even on Windows inside the drawtext option string
  const fontPart = fontPath
    ? `fontfile='${fontPath.replace(/\\/g, '/')}':`
    : ''

  const xExpr = position.includes('Left')
    ? `${pad}`
    : position.includes('Right')
      ? `w-text_w-${pad}`
      : `(w-text_w)/2`

  const filters = lines.map((line, i) => {
    const escaped = escapeDrawtext(line)

    let yExpr: string
    if (position.startsWith('Bottom')) {
      // anchor last line to the bottom; earlier lines stack upward
      yExpr = `h-${(nLines - i) * lineHeight + pad}`
    } else if (position === 'Center') {
      yExpr = `(h-${nLines * lineHeight})/2+${i * lineHeight}`
    } else {
      // Top* positions
      yExpr = `${pad + i * lineHeight}`
    }

    // alpha= applies uniformly to fill + border — fontcolor@X only affects fill
    // which made the setting appear to have no effect because the border stayed opaque
    return [
      `drawtext=${fontPart}`,
      `text='${escaped}':`,
      `fontsize=${fontSize}:`,
      `fontcolor=white:borderw=2:bordercolor=black:`,
      `alpha=${opacity.toFixed(2)}:`,
      `x=${xExpr}:y=${yExpr}`,
    ].join('')
  })

  return filters.join(',')
}

// ── Image overlay helpers ─────────────────────────────────────────────────────

function buildOverlayFilter(opacity: number, position: string): string {
  const pad = 24
  let x: string
  let y: string

  if (position.includes('Left'))        x = `${pad}`
  else if (position.includes('Right'))  x = `main_w-overlay_w-${pad}`
  else                                  x = `(main_w-overlay_w)/2`

  if (position.startsWith('Top'))       y = `${pad}`
  else if (position === 'Center')       y = `(main_h-overlay_h)/2`
  else                                  y = `main_h-overlay_h-${pad}`

  // Scale the watermark to at most 25% of video width, preserve aspect ratio
  // Then apply opacity via colorchannelmixer (alpha channel scale)
  const alphaVal = opacity.toFixed(4)
  return [
    `[1:v]scale=iw*min(W*0.25/iw\\,1):ih*min(W*0.25/iw\\,1),`,
    `format=rgba,`,
    `colorchannelmixer=aa=${alphaVal}`,
    `[wm];`,
    `[0:v][wm]overlay=${x}:${y}`,
  ].join('')
}

// ── Core watermarking ─────────────────────────────────────────────────────────

interface WatermarkResult {
  cleanUrl:       string
  watermarkedUrl: string
}

async function applyWatermark(videoUrl: string, referenceId: string): Promise<WatermarkResult> {
  const settings       = await settingsService.get()
  const opacity        = Math.min(1, Math.max(0, parseFloat(settings.watermarkOpacity || '0.70')))
  const position       = settings.watermarkPosition || 'Bottom Center'
  const watermarkImage = settings.watermarkImageUrl || ''

  logger.info(`[Watermark] Starting: job=${referenceId}, mode=${watermarkImage ? 'image' : 'text'}, position=${position}, opacity=${opacity}`)

  const videoRes = await fetch(videoUrl)
  if (!videoRes.ok) throw new Error(`Failed to download video (HTTP ${videoRes.status})`)
  const videoBuffer = Buffer.from(await videoRes.arrayBuffer())

  const uid        = randomUUID()
  const inputPath  = join(tmpdir(), `tw-${uid}-in.mp4`)
  const outputPath = join(tmpdir(), `tw-${uid}-out.mp4`)
  const imagePath  = watermarkImage ? join(tmpdir(), `tw-${uid}-wm.png`) : null

  try {
    await writeFile(inputPath, videoBuffer)

    if (imagePath && watermarkImage) {
      const imgRes = await fetch(watermarkImage)
      if (!imgRes.ok) throw new Error(`Failed to download watermark image (HTTP ${imgRes.status})`)
      await writeFile(imagePath, Buffer.from(await imgRes.arrayBuffer()))
    }

    // Resolve font before entering the ffmpeg Promise (getFont is async)
    const resolvedFont = imagePath ? null : await getFont()

    await new Promise<void>((resolve, reject) => {
      const cmd = ffmpeg(inputPath)

      if (imagePath) {
        const overlayFilter = buildOverlayFilter(opacity, position)
        logger.info(`[Watermark] overlay filter: ${overlayFilter}`)
        cmd
          .input(imagePath)
          .complexFilter(overlayFilter)
      } else {
        const text     = settings.watermarkText || 'twinity.ai PREVIEW'
        const vfFilter = buildDrawtextFilter(text, opacity, position, resolvedFont?.path ?? null)
        logger.info(`[Watermark] drawtext filter: ${vfFilter}`)
        cmd.videoFilters(vfFilter)
      }

      cmd
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

    // Store the raw S3 URL (no presigned query string) — presigning happens
    // on-demand in signJobUrls when serving the job to clients.
    const cleanUrl       = cleanUpload.url
    const watermarkedUrl = watermarkedUpload.url

    logger.info(`[Watermark] Done: job=${referenceId}`)
    return { cleanUrl, watermarkedUrl }
  } finally {
    await Promise.all([
      unlink(inputPath).catch(() => null),
      unlink(outputPath).catch(() => null),
      imagePath ? unlink(imagePath).catch(() => null) : Promise.resolve(),
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
