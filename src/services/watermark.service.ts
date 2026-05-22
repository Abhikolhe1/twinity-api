/**
 * Watermark Service — bakes a text watermark into a video.
 *
 * Approach:
 *   ffmpeg drawtext filter — uses ffmpeg's built-in FreeType renderer.
 *   No dependency on sharp/librsvg/fontconfig (the prior PNG-overlay approach
 *   silently produced transparent PNGs when system fonts were absent).
 *
 * Settings consumed (from Settings DB):
 *   watermarkText     — e.g. "twinity.ai PREVIEW"
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

  const borderOpacity = Math.min(1, opacity + 0.3).toFixed(2)

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

    return [
      `drawtext=${fontPart}`,
      `text='${escaped}':`,
      `fontsize=${fontSize}:`,
      `fontcolor=white@${opacity.toFixed(2)}:`,
      `x=${xExpr}:y=${yExpr}:`,
      `borderw=2:bordercolor=black@${borderOpacity}`,
    ].join('')
  })

  return filters.join(',')
}

// ── Core watermarking ─────────────────────────────────────────────────────────

interface WatermarkResult {
  cleanUrl:       string
  watermarkedUrl: string
}

async function applyWatermark(videoUrl: string, referenceId: string): Promise<WatermarkResult> {
  const settings = await settingsService.get()
  const text     = settings.watermarkText     || 'twinity.ai PREVIEW'
  const opacity  = Math.min(1, Math.max(0.2, parseFloat(settings.watermarkOpacity || '0.70')))
  const position = settings.watermarkPosition || 'Bottom Center'

  logger.info(`[Watermark] Starting: job=${referenceId}, position=${position}, opacity=${opacity}`)

  const videoRes = await fetch(videoUrl)
  if (!videoRes.ok) throw new Error(`Failed to download video (HTTP ${videoRes.status})`)
  const videoBuffer = Buffer.from(await videoRes.arrayBuffer())

  const uid        = randomUUID()
  const inputPath  = join(tmpdir(), `tw-${uid}-in.mp4`)
  const outputPath = join(tmpdir(), `tw-${uid}-out.mp4`)

  try {
    await writeFile(inputPath, videoBuffer)

    const font     = await getFont()
    const vfFilter = buildDrawtextFilter(text, opacity, position, font?.path ?? null)
    logger.info(`[Watermark] drawtext filter: ${vfFilter}`)

    await new Promise<void>((resolve, reject) => {
      ffmpeg(inputPath)
        .videoFilters(vfFilter)
        .outputOptions([
          '-c:a copy',
          '-movflags +faststart',
        ])
        .save(outputPath)
        .on('end', () => resolve())
        .on('error', (err: Error) => reject(err))
    })

    const outBuffer       = await readFile(outputPath)
    const { s3Bucket }    = await settingsService.get()

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
