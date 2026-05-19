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

const SECRET_FIELDS = [
  'eleven_labs_key',
  'creatify_api_id',
  'creatify_api_key',
  'openai_key',
  'gemini_api_key',
  'aws_secret_access_key',
] as const

// Map camelCase keys sent by the admin frontend to snake_case DB field names
const CAMEL_TO_SNAKE: Record<string, string> = {
  platformName:          'platform_name',
  supportEmail:          'support_email',
  adminEmail:            'admin_email',
  elevenLabsKey:         'eleven_labs_key',
  creatifyApiId:         'creatify_api_id',
  creatifyApiKey:        'creatify_api_key',
  openaiKey:             'openai_key',
  geminiApiKey:          'gemini_api_key',
  watermarkText:         'watermark_text',
  watermarkOpacity:      'watermark_opacity',
  watermarkPosition:     'watermark_position',
  awsAccessKeyId:        'aws_access_key_id',
  awsSecretAccessKey:    'aws_secret_access_key',
  awsRegion:             'aws_region',
  s3Bucket:              's3_bucket',
  blockedWords:          'blocked_words',
  scriptImprovePrompt:   'script_improve_prompt',
  scriptEnhancePrompt:   'script_enhance_prompt',
  thumbnailProcessPrompt:'thumbnail_process_prompt',
}

function normaliseBody(body: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(body)) {
    const mapped = CAMEL_TO_SNAKE[k] ?? k
    out[mapped] = v
  }
  return out
}

function toPublic(raw: Record<string, unknown>): Record<string, unknown> {
  const doc = { ...raw }
  for (const f of SECRET_FIELDS) {
    if (doc[f]) doc[f] = maskKey(doc[f] as string)
  }
  return doc
}

export async function getSettings(_req: Request, res: Response): Promise<void> {
  try {
    let settings = await prisma.settings.findUnique({ where: { key: 'default' } })
    if (!settings) {
      settings = await prisma.settings.create({ data: { key: 'default' } })
    }
    res.json({ success: true, data: toPublic(settings as unknown as Record<string, unknown>) })
  } catch {
    res.status(500).json({ success: false, message: 'Failed to load settings' })
  }
}

export async function getBlockedWords(_req: Request, res: Response): Promise<void> {
  try {
    const settings = await prisma.settings.findUnique({ where: { key: 'default' } })
    res.json({ success: true, data: settings?.blocked_words ?? [] })
  } catch {
    res.status(500).json({ success: false, message: 'Failed to load blocked words' })
  }
}

export async function addBlockedWord(req: Request, res: Response): Promise<void> {
  try {
    const raw = req.body.words ?? req.body.word
    const words = (Array.isArray(raw) ? raw : [raw])
      .map((w: unknown) => String(w).trim().toLowerCase())
      .filter(Boolean)
    if (!words.length) { res.status(400).json({ success: false, message: 'words is required' }); return }

    const current = await prisma.settings.findUnique({ where: { key: 'default' } })
    const existing = current?.blocked_words ?? []
    const merged = Array.from(new Set([...existing, ...words]))

    const settings = await prisma.settings.upsert({
      where:  { key: 'default' },
      update: { blocked_words: merged },
      create: { key: 'default', blocked_words: merged },
    })

    settingsService.invalidate()
    res.json({ success: true, data: settings.blocked_words })
  } catch {
    res.status(500).json({ success: false, message: 'Failed to add words' })
  }
}

export async function removeBlockedWord(req: Request, res: Response): Promise<void> {
  try {
    const word = decodeURIComponent(req.params.word).trim().toLowerCase()

    const current = await prisma.settings.findUnique({ where: { key: 'default' } })
    const updated = (current?.blocked_words ?? []).filter((w: string) => w !== word)

    const settings = await prisma.settings.update({
      where: { key: 'default' },
      data:  { blocked_words: updated },
    }).catch(() => null)

    settingsService.invalidate()
    res.json({ success: true, data: settings?.blocked_words ?? [] })
  } catch {
    res.status(500).json({ success: false, message: 'Failed to remove word' })
  }
}

export async function updateSettings(req: Request, res: Response): Promise<void> {
  try {
    const body = normaliseBody({ ...req.body })

    for (const field of SECRET_FIELDS) {
      if (isMasked(body[field] as string | undefined)) delete body[field]
    }

    delete body.key

    const settings = await prisma.settings.upsert({
      where:  { key: 'default' },
      update: body,
      create: { key: 'default', ...body },
    })

    settingsService.invalidate()
    res.json({ success: true, data: toPublic(settings as unknown as Record<string, unknown>) })
  } catch {
    res.status(500).json({ success: false, message: 'Failed to save settings' })
  }
}
