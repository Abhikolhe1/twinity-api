import { Request, Response } from 'express'
import { Settings } from '../models/Settings'

const MASKED_SENTINEL = '**'

function isMasked(val: string | undefined): boolean {
  if (!val) return false
  return val.includes(MASKED_SENTINEL)
}

function maskKey(val: string): string {
  if (!val) return ''
  const parts = val.split('-')
  if (parts.length >= 2) {
    return parts[0] + '-' + parts[1] + '-**'
  }
  if (val.length <= 6) return '**'
  return val.slice(0, 6) + '-**'
}

function toPublic(raw: unknown): Record<string, unknown> {
  const doc = raw as Record<string, unknown>
  if (doc.elevenLabsKey) doc.elevenLabsKey = maskKey(doc.elevenLabsKey as string)
  if (doc.syncLabsKey)   doc.syncLabsKey   = maskKey(doc.syncLabsKey as string)
  if (doc.higgsfieldKey) doc.higgsfieldKey = maskKey(doc.higgsfieldKey as string)
  return doc
}

export async function getSettings(req: Request, res: Response): Promise<void> {
  try {
    let settings = await Settings.findOne({ key: 'global' })
    if (!settings) {
      settings = await Settings.create({ key: 'global' })
    }
    res.json({ success: true, data: toPublic(settings.toObject()) })
  } catch {
    res.status(500).json({ success: false, message: 'Failed to load settings' })
  }
}

export async function updateSettings(req: Request, res: Response): Promise<void> {
  try {
    const body = { ...req.body }

    const secretFields = ['elevenLabsKey', 'syncLabsKey', 'higgsfieldKey'] as const
    for (const field of secretFields) {
      if (isMasked(body[field])) {
        delete body[field]
      }
    }

    delete body.key

    const settings = await Settings.findOneAndUpdate(
      { key: 'global' },
      { $set: body },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    )

    res.json({ success: true, data: toPublic(settings.toObject()) })
  } catch {
    res.status(500).json({ success: false, message: 'Failed to save settings' })
  }
}
