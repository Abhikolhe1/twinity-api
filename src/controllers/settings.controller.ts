import { Request, Response } from 'express'
import { Settings } from '../models/Settings'
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
  'elevenLabsKey',
  'creatifyApiId',
  'creatifyApiKey',
  'openaiKey',
  'geminiApiKey',
  'awsSecretAccessKey',
] as const

function toPublic(raw: Record<string, unknown>): Record<string, unknown> {
  const doc = { ...raw }
  for (const f of SECRET_FIELDS) {
    if (doc[f]) doc[f] = maskKey(doc[f] as string)
  }
  return doc
}

export async function getSettings(_req: Request, res: Response): Promise<void> {
  try {
    let settings = await Settings.findOne({ key: 'global' })
    if (!settings) {
      settings = await Settings.create({ key: 'global' })
    }
    res.json({ success: true, data: toPublic(settings.toObject() as unknown as Record<string, unknown>) })
  } catch {
    res.status(500).json({ success: false, message: 'Failed to load settings' })
  }
}

export async function getBlockedWords(_req: Request, res: Response): Promise<void> {
  try {
    const settings = await Settings.findOne({ key: 'global' })
    res.json({ success: true, data: settings?.blockedWords ?? [] })
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
    const settings = await Settings.findOneAndUpdate(
      { key: 'global' },
      { $addToSet: { blockedWords: { $each: words } } },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    )
    settingsService.invalidate()
    res.json({ success: true, data: settings.blockedWords })
  } catch {
    res.status(500).json({ success: false, message: 'Failed to add words' })
  }
}

export async function removeBlockedWord(req: Request, res: Response): Promise<void> {
  try {
    const word = decodeURIComponent(req.params.word).trim().toLowerCase()
    const settings = await Settings.findOneAndUpdate(
      { key: 'global' },
      { $pull: { blockedWords: word } },
      { new: true },
    )
    settingsService.invalidate()
    res.json({ success: true, data: settings?.blockedWords ?? [] })
  } catch {
    res.status(500).json({ success: false, message: 'Failed to remove word' })
  }
}

export async function updateSettings(req: Request, res: Response): Promise<void> {
  try {
    const body = { ...req.body }

    // Never overwrite a real secret with a masked placeholder
    for (const field of SECRET_FIELDS) {
      if (isMasked(body[field])) delete body[field]
    }

    // Prevent overwriting the singleton key
    delete body.key

    const settings = await Settings.findOneAndUpdate(
      { key: 'global' },
      { $set: body },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    )

    settingsService.invalidate()
    res.json({ success: true, data: toPublic(settings.toObject() as unknown as Record<string, unknown>) })
  } catch {
    res.status(500).json({ success: false, message: 'Failed to save settings' })
  }
}
