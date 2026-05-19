import { Request, Response } from 'express'
import prisma from '../lib/prisma'
import { settingsService } from '../services/settings.service'

const MASKED_SENTINEL = '**'

function isMasked(val: string | undefined): boolean {
  return typeof val === 'string' && val.includes(MASKED_SENTINEL)
}

function maskKey(val: string): string {
  if (!val) return ''
  const parts = val.split('-')
  if (parts.length >= 2) return parts[0] + '-' + parts[1] + '-**'
  if (val.length <= 6) return '**'
  return val.slice(0, 6) + '-**'
}

const SECRET_KEYS = new Set([
  'eleven_labs_key',
  'creatify_api_id',
  'creatify_api_key',
  'openai_key',
  'gemini_api_key',
  'aws_secret_access_key',
])

// Map camelCase keys sent by the admin frontend to snake_case DB keys
const CAMEL_TO_SNAKE: Record<string, string> = {
  platformName:           'platform_name',
  supportEmail:           'support_email',
  adminEmail:             'admin_email',
  elevenLabsKey:          'eleven_labs_key',
  creatifyApiId:          'creatify_api_id',
  creatifyApiKey:         'creatify_api_key',
  openaiKey:              'openai_key',
  geminiApiKey:           'gemini_api_key',
  watermarkText:          'watermark_text',
  watermarkOpacity:       'watermark_opacity',
  watermarkPosition:      'watermark_position',
  awsAccessKeyId:         'aws_access_key_id',
  awsSecretAccessKey:     'aws_secret_access_key',
  awsRegion:              'aws_region',
  s3Bucket:               's3_bucket',
  scriptImprovePrompt:    'script_improve_prompt',
  scriptEnhancePrompt:    'script_enhance_prompt',
  thumbnailProcessPrompt: 'thumbnail_process_prompt',
}

// Type groupings for each key
const KEY_TYPE: Record<string, string> = {
  platform_name:           'general',
  support_email:           'general',
  admin_email:             'general',
  eleven_labs_key:         'ai',
  creatify_api_id:         'ai',
  creatify_api_key:        'ai',
  openai_key:              'ai',
  gemini_api_key:          'ai',
  watermark_text:          'watermark',
  watermark_opacity:       'watermark',
  watermark_position:      'watermark',
  aws_access_key_id:       's3',
  aws_secret_access_key:   's3',
  aws_region:              's3',
  s3_bucket:               's3',
  script_improve_prompt:   'ai_prompts',
  script_enhance_prompt:   'ai_prompts',
  thumbnail_process_prompt:'ai_prompts',
}

// Map camelCase body keys (from admin frontend) to snake_case, then upsert each
async function upsertKeys(body: Record<string, unknown>): Promise<void> {
  const ops: Promise<unknown>[] = []
  for (const [rawKey, rawVal] of Object.entries(body)) {
    const key  = CAMEL_TO_SNAKE[rawKey] ?? rawKey
    const type = KEY_TYPE[key] ?? 'general'
    const val  = rawVal != null ? String(rawVal) : ''
    ops.push(
      prisma.setting.upsert({
        where:  { key },
        update: { value: val, type },
        create: { key, value: val, type },
      })
    )
  }
  await Promise.all(ops)
}

// Build a flat camelCase object from all rows (for the admin frontend)
function rowsToFlat(rows: { key: string; value: string }[]): Record<string, unknown> {
  const SNAKE_TO_CAMEL = Object.fromEntries(
    Object.entries(CAMEL_TO_SNAKE).map(([c, s]) => [s, c])
  )
  const out: Record<string, unknown> = {}
  for (const row of rows) {
    const camel = SNAKE_TO_CAMEL[row.key] ?? row.key
    out[camel] = SECRET_KEYS.has(row.key) ? maskKey(row.value) : row.value
  }
  return out
}

export async function getSettings(_req: Request, res: Response): Promise<void> {
  try {
    const rows = await prisma.setting.findMany()
    res.json({ success: true, data: rowsToFlat(rows) })
  } catch {
    res.status(500).json({ success: false, message: 'Failed to load settings' })
  }
}

export async function updateSettings(req: Request, res: Response): Promise<void> {
  try {
    const body = { ...req.body }

    // Drop masked secret values so they aren't overwritten
    for (const [rawKey, rawVal] of Object.entries(body)) {
      if (isMasked(rawVal as string | undefined)) delete body[rawKey]
    }

    await upsertKeys(body)
    settingsService.invalidate()

    const rows = await prisma.setting.findMany()
    res.json({ success: true, data: rowsToFlat(rows) })
  } catch {
    res.status(500).json({ success: false, message: 'Failed to save settings' })
  }
}

export async function getBlockedWords(_req: Request, res: Response): Promise<void> {
  try {
    const rows = await prisma.blockedWord.findMany({ orderBy: { word: 'asc' } })
    res.json({ success: true, data: rows.map(r => r.word) })
  } catch {
    res.status(500).json({ success: false, message: 'Failed to load blocked words' })
  }
}

export async function addBlockedWord(req: Request, res: Response): Promise<void> {
  try {
    const raw = req.body.words ?? req.body.word
    const incoming = (Array.isArray(raw) ? raw : [raw])
      .map((w: unknown) => String(w).trim().toLowerCase())
      .filter(Boolean)
    if (!incoming.length) { res.status(400).json({ success: false, message: 'words is required' }); return }

    await Promise.all(
      incoming.map((word: string) =>
        prisma.blockedWord.upsert({
          where:  { word },
          update: {},
          create: { word },
        })
      )
    )

    const rows = await prisma.blockedWord.findMany({ orderBy: { word: 'asc' } })
    res.json({ success: true, data: rows.map(r => r.word) })
  } catch {
    res.status(500).json({ success: false, message: 'Failed to add words' })
  }
}

export async function removeBlockedWord(req: Request, res: Response): Promise<void> {
  try {
    const word = decodeURIComponent(req.params.word).trim().toLowerCase()
    await prisma.blockedWord.deleteMany({ where: { word } })
    const rows = await prisma.blockedWord.findMany({ orderBy: { word: 'asc' } })
    res.json({ success: true, data: rows.map(r => r.word) })
  } catch {
    res.status(500).json({ success: false, message: 'Failed to remove word' })
  }
}
