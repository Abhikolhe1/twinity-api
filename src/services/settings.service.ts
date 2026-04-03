/**
 * Settings Service — loads platform config and API keys from DB.
 * Caches the result for CACHE_TTL_MS to avoid a DB hit on every request.
 */
import { Settings } from '../models/Settings'
import { env } from '../config/env'
import { logger } from '../config/logger'

const CACHE_TTL_MS = 30_000

interface CachedSettings {
  elevenLabsKey: string
  higgsfieldKeyId: string
  higgsfieldKeySecret: string
  openaiKey: string
  watermarkText: string
  watermarkOpacity: string
  watermarkPosition: string
  platformName: string
  adminEmail: string
  awsAccessKeyId: string
  awsSecretAccessKey: string
  awsRegion: string
  s3Bucket: string
}

let _cache: CachedSettings | null = null
let _cacheAt = 0

async function load(): Promise<CachedSettings> {
  const now = Date.now()
  if (_cache && now - _cacheAt < CACHE_TTL_MS) return _cache

  try {
    const doc = await Settings.findOne({ key: 'global' })
    const d = (doc?.toObject() ?? {}) as Record<string, string>
    _cache = {
      elevenLabsKey:  d.elevenLabsKey  || env.externalApis.elevenLabs  || '',
      higgsfieldKeyId:     d.higgsfieldKeyId     || env.externalApis.higgsfieldKeyId     || '',
      higgsfieldKeySecret: d.higgsfieldKeySecret || env.externalApis.higgsfieldKeySecret || '',
      openaiKey:      d.openaiKey      || env.externalApis.openai      || '',
      watermarkText:     d.watermarkText     || 'twinity.ai · PREVIEW',
      watermarkOpacity:  d.watermarkOpacity  || '0.35',
      watermarkPosition: d.watermarkPosition || 'Bottom Center',
      platformName:      d.platformName      || 'Twinity',
      adminEmail:        d.adminEmail        || env.ses.adminEmail,
      awsAccessKeyId:     d.awsAccessKeyId     || env.aws.accessKeyId     || '',
      awsSecretAccessKey: d.awsSecretAccessKey  || env.aws.secretAccessKey  || '',
      awsRegion:          d.awsRegion           || env.aws.region           || 'us-east-1',
      s3Bucket:           d.s3Bucket            || env.aws.s3Buckets.assets || 'twinity-storage',
    }
    _cacheAt = now
  } catch (err) {
    logger.error('[Settings] Failed to load from DB, using env fallback:', err)
    _cache = {
      elevenLabsKey:  env.externalApis.elevenLabs  || '',
      higgsfieldKeyId:     env.externalApis.higgsfieldKeyId     || '',
      higgsfieldKeySecret: env.externalApis.higgsfieldKeySecret || '',
      openaiKey:      env.externalApis.openai      || '',
      watermarkText:     'twinity.ai · PREVIEW',
      watermarkOpacity:  '0.35',
      watermarkPosition: 'Bottom Center',
      platformName:      'Twinity',
      adminEmail:        env.ses.adminEmail,
      awsAccessKeyId:     env.aws.accessKeyId     || '',
      awsSecretAccessKey: env.aws.secretAccessKey  || '',
      awsRegion:          env.aws.region           || 'us-east-1',
      s3Bucket:           env.aws.s3Buckets.assets || 'twinity-storage',
    }
    _cacheAt = now
  }
  return _cache
}

export const settingsService = {
  get: load,
  invalidate() { _cache = null; _cacheAt = 0 },
}
