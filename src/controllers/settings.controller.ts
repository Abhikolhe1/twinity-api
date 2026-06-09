import { Request, Response } from 'express'
import prisma from '../lib/prisma'
import { settingsService } from '../services/settings.service'
import { s3Service } from '../services/s3.service'

const MASKED_SENTINEL = '**'
const CELEBRITY_LANGUAGE_MASTER_KEY = 'celebrity_language_master'
const CELEBRITY_NATIONALITY_MASTER_KEY = 'celebrity_nationality_master'

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
  'fal_api_key',
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
  falApiKey:              'fal_api_key',
  openaiKey:              'openai_key',
  geminiApiKey:           'gemini_api_key',
  watermarkText:          'watermark_text',
  watermarkOpacity:       'watermark_opacity',
  watermarkPosition:      'watermark_position',
  watermarkImageUrl:      'watermark_image_url',
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
  fal_api_key:             'ai',
  openai_key:              'ai',
  gemini_api_key:          'ai',
  watermark_text:          'watermark',
  watermark_opacity:       'watermark',
  watermark_position:      'watermark',
  watermark_image_url:     'watermark',
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

async function presignSettingsData(data: Record<string, unknown>): Promise<Record<string, unknown>> {
  const imageUrl = data.watermarkImageUrl as string | undefined
  if (imageUrl) {
    const signed = await s3Service.presignIfS3(imageUrl)
    return { ...data, watermarkImageUrl: signed }
  }
  return data
}

function normalizeMasterItems(value: unknown): string[] {
  if (Array.isArray(value)) {
    return Array.from(new Set(value.map((item) => String(item).trim()).filter(Boolean)))
  }
  if (typeof value === 'string') {
    return Array.from(new Set(
      value
        .split(/\r?\n|,/)
        .map((item) => item.trim())
        .filter(Boolean),
    ))
  }
  return []
}

async function readCelebrityMasters() {
  const rows = await prisma.setting.findMany({
    where: {
      key: {
        in: [CELEBRITY_LANGUAGE_MASTER_KEY, CELEBRITY_NATIONALITY_MASTER_KEY],
      },
    },
  })

  const rowByKey = new Map(rows.map((row) => [row.key, row.value]))
  const parseStored = (raw?: string) => {
    if (!raw) return []
    try {
      return normalizeMasterItems(JSON.parse(raw))
    } catch {
      return normalizeMasterItems(raw)
    }
  }

  return {
    languages: parseStored(rowByKey.get(CELEBRITY_LANGUAGE_MASTER_KEY)),
    nationalities: parseStored(rowByKey.get(CELEBRITY_NATIONALITY_MASTER_KEY)),
  }
}

function getCelebrityMasterKey(type?: string): string | null {
  if (type === 'languages') return CELEBRITY_LANGUAGE_MASTER_KEY
  if (type === 'nationalities') return CELEBRITY_NATIONALITY_MASTER_KEY
  return null
}

async function readCelebrityMasterList(type: 'languages' | 'nationalities'): Promise<string[]> {
  const key = getCelebrityMasterKey(type)
  if (!key) return []

  const row = await prisma.setting.findUnique({ where: { key } })
  if (!row?.value) return []

  try {
    return normalizeMasterItems(JSON.parse(row.value))
  } catch {
    return normalizeMasterItems(row.value)
  }
}

export async function getSettings(_req: Request, res: Response): Promise<void> {
  try {
    const rows = await prisma.setting.findMany()
    const data = await presignSettingsData(rowsToFlat(rows))
    res.json({ success: true, data })
  } catch {
    res.status(500).json({ success: false, message: 'Failed to load settings' })
  }
}

export async function getCelebrityMasters(_req: Request, res: Response): Promise<void> {
  try {
    const data = await readCelebrityMasters()
    res.json({ success: true, data })
  } catch {
    res.status(500).json({ success: false, message: 'Failed to load celebrity masters' })
  }
}

export async function updateCelebrityMasters(req: Request, res: Response): Promise<void> {
  try {
    const languages = normalizeMasterItems(req.body?.languages)
    const nationalities = normalizeMasterItems(req.body?.nationalities)

    await Promise.all([
      prisma.setting.upsert({
        where: { key: CELEBRITY_LANGUAGE_MASTER_KEY },
        update: { value: JSON.stringify(languages), type: 'general' },
        create: { key: CELEBRITY_LANGUAGE_MASTER_KEY, value: JSON.stringify(languages), type: 'general' },
      }),
      prisma.setting.upsert({
        where: { key: CELEBRITY_NATIONALITY_MASTER_KEY },
        update: { value: JSON.stringify(nationalities), type: 'general' },
        create: { key: CELEBRITY_NATIONALITY_MASTER_KEY, value: JSON.stringify(nationalities), type: 'general' },
      }),
    ])

    settingsService.invalidate()
    res.json({ success: true, data: { languages, nationalities } })
  } catch {
    res.status(500).json({ success: false, message: 'Failed to save celebrity masters' })
  }
}

export async function getCelebrityMasterByType(req: Request, res: Response): Promise<void> {
  try {
    const type = String(req.params.type || '') as 'languages' | 'nationalities'
    const key = getCelebrityMasterKey(type)
    if (!key) {
      res.status(400).json({ success: false, message: 'Unsupported celebrity master type' })
      return
    }

    const values = await readCelebrityMasterList(type)
    res.json({ success: true, data: { type, values } })
  } catch {
    res.status(500).json({ success: false, message: 'Failed to load celebrity master' })
  }
}

export async function addCelebrityMasterValue(req: Request, res: Response): Promise<void> {
  try {
    const type = String(req.params.type || '') as 'languages' | 'nationalities'
    const key = getCelebrityMasterKey(type)
    if (!key) {
      res.status(400).json({ success: false, message: 'Unsupported celebrity master type' })
      return
    }

    const value = String(req.body?.value || '').trim()
    if (!value) {
      res.status(400).json({ success: false, message: 'value is required' })
      return
    }

    const current = await readCelebrityMasterList(type)
    const values = Array.from(new Set([...current, value]))

    await prisma.setting.upsert({
      where: { key },
      update: { value: JSON.stringify(values), type: 'general' },
      create: { key, value: JSON.stringify(values), type: 'general' },
    })

    settingsService.invalidate()
    res.json({ success: true, data: { type, values } })
  } catch {
    res.status(500).json({ success: false, message: 'Failed to add celebrity master value' })
  }
}

export async function replaceCelebrityMasterValues(req: Request, res: Response): Promise<void> {
  try {
    const type = String(req.params.type || '') as 'languages' | 'nationalities'
    const key = getCelebrityMasterKey(type)
    if (!key) {
      res.status(400).json({ success: false, message: 'Unsupported celebrity master type' })
      return
    }

    const values = normalizeMasterItems(req.body?.values)

    await prisma.setting.upsert({
      where: { key },
      update: { value: JSON.stringify(values), type: 'general' },
      create: { key, value: JSON.stringify(values), type: 'general' },
    })

    settingsService.invalidate()
    res.json({ success: true, data: { type, values } })
  } catch {
    res.status(500).json({ success: false, message: 'Failed to replace celebrity master values' })
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

export async function uploadWatermarkImage(req: Request, res: Response): Promise<void> {
  try {
    const file = (req as Request & { file?: Express.Multer.File }).file
    if (!file) { res.status(400).json({ success: false, message: 'No image file provided' }); return }

    const { s3Bucket } = await settingsService.get()
    const ext    = file.originalname.split('.').pop()?.toLowerCase() || 'png'
    const key    = `watermark/watermark-image.${ext}`
    const result = await s3Service.upload(s3Bucket, key, file.buffer, file.mimetype)

    await upsertKeys({ watermarkImageUrl: result.url })
    settingsService.invalidate()

    const displayUrl = result.stub ? result.url : await s3Service.getPresignedUrl(s3Bucket, result.key)
    res.json({ success: true, url: displayUrl })
  } catch {
    res.status(500).json({ success: false, message: 'Failed to upload watermark image' })
  }
}

export async function deleteWatermarkImage(_req: Request, res: Response): Promise<void> {
  try {
    await upsertKeys({ watermarkImageUrl: '' })
    settingsService.invalidate()
    res.json({ success: true })
  } catch {
    res.status(500).json({ success: false, message: 'Failed to remove watermark image' })
  }
}
