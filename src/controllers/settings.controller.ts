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

    // Fetch-then-update to merge arrays (Prisma doesn't support $addToSet)
    const current = await prisma.settings.findUnique({ where: { key: 'default' } })
    const existing = current?.blockedWords ?? []
    const merged = Array.from(new Set([...existing, ...words]))

    const settings = await prisma.settings.upsert({
      where: { key: 'default' },
      update: { blockedWords: merged },
      create: { key: 'default', blockedWords: merged },
    })

    settingsService.invalidate()
    res.json({ success: true, data: settings.blockedWords })
  } catch {
    res.status(500).json({ success: false, message: 'Failed to add words' })
  }
}

export async function removeBlockedWord(req: Request, res: Response): Promise<void> {
  try {
    const word = decodeURIComponent(req.params.word).trim().toLowerCase()

    const current = await prisma.settings.findUnique({ where: { key: 'default' } })
    const updated = (current?.blockedWords ?? []).filter((w: string) => w !== word)

    const settings = await prisma.settings.update({
      where: { key: 'default' },
      data: { blockedWords: updated },
    }).catch(() => null)

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

    const settings = await prisma.settings.upsert({
      where: { key: 'default' },
      update: body,
      create: { key: 'default', ...body },
    })

    settingsService.invalidate()
    res.json({ success: true, data: toPublic(settings as unknown as Record<string, unknown>) })
  } catch {
    res.status(500).json({ success: false, message: 'Failed to save settings' })
  }
}
