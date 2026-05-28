/**
 * Settings Service — loads platform config and API keys from DB.
 * Caches the result for CACHE_TTL_MS to avoid a DB hit on every request.
 */
import prisma from '../lib/prisma'
import { env } from '../config/env'
import { logger } from '../config/logger'

const CACHE_TTL_MS = 30_000

interface CachedSettings {
  elevenLabsKey: string
  creatifyApiId: string
  creatifyApiKey: string
  falApiKey: string
  openaiKey: string
  geminiApiKey: string
  watermarkText: string
  watermarkOpacity: string
  watermarkPosition: string
  watermarkImageUrl: string
  platformName: string
  adminEmail: string
  awsAccessKeyId: string
  awsSecretAccessKey: string
  awsRegion: string
  s3Bucket: string
  scriptImprovePrompt: string
  scriptEnhancePrompt: string
  thumbnailProcessPrompt: string
}

let _cache: CachedSettings | null = null
let _cacheAt = 0

async function load(): Promise<CachedSettings> {
  const now = Date.now()
  if (_cache && now - _cacheAt < CACHE_TTL_MS) return _cache

  try {
    const rows = await prisma.setting.findMany()
    const d: Record<string, string> = {}
    for (const row of rows) d[row.key] = row.value

    _cache = {
      elevenLabsKey:  d.eleven_labs_key  || env.externalApis.elevenLabs     || '',
      creatifyApiId:  d.creatify_api_id  || env.externalApis.creatifyApiId  || '',
      creatifyApiKey: d.creatify_api_key || env.externalApis.creatifyApiKey || '',
      falApiKey:      d.fal_api_key      || env.externalApis.falApiKey      || '',
      openaiKey:      d.openai_key       || env.externalApis.openai         || '',
      geminiApiKey:   d.gemini_api_key   || '',
      watermarkText:     d.watermark_text      || 'twinity.ai · PREVIEW',
      watermarkOpacity:  d.watermark_opacity   || '0.35',
      watermarkPosition: d.watermark_position  || 'Bottom Center',
      watermarkImageUrl: d.watermark_image_url || '',
      platformName:      d.platform_name       || 'Twinity',
      adminEmail:        d.admin_email        || env.ses.adminEmail,
      awsAccessKeyId:     d.aws_access_key_id     || env.aws.accessKeyId     || '',
      awsSecretAccessKey: d.aws_secret_access_key || env.aws.secretAccessKey || '',
      awsRegion:          d.aws_region            || env.aws.region          || 'us-east-1',
      s3Bucket:           d.s3_bucket             || env.aws.s3Buckets.assets || 'twinity-storage',
      scriptImprovePrompt:    d.script_improve_prompt    || '',
      scriptEnhancePrompt:    d.script_enhance_prompt    || '',
      thumbnailProcessPrompt: d.thumbnail_process_prompt || '',
    }
    _cacheAt = now
  } catch (err) {
    logger.error('[Settings] Failed to load from DB, using env fallback:', err)
    _cache = {
      elevenLabsKey:  env.externalApis.elevenLabs     || '',
      creatifyApiId:  env.externalApis.creatifyApiId  || '',
      creatifyApiKey: env.externalApis.creatifyApiKey || '',
      falApiKey:      env.externalApis.falApiKey      || '',
      openaiKey:      env.externalApis.openai         || '',
      geminiApiKey:   '',
      watermarkText:     'twinity.ai · PREVIEW',
      watermarkOpacity:  '0.35',
      watermarkPosition: 'Bottom Center',
      watermarkImageUrl: '',
      platformName:      'Twinity',
      adminEmail:        env.ses.adminEmail,
      awsAccessKeyId:     env.aws.accessKeyId     || '',
      awsSecretAccessKey: env.aws.secretAccessKey || '',
      awsRegion:          env.aws.region          || 'us-east-1',
      s3Bucket:           env.aws.s3Buckets.assets || 'twinity-storage',
      scriptImprovePrompt:    '',
      scriptEnhancePrompt:    '',
      thumbnailProcessPrompt: '',
    }
    _cacheAt = now
  }
  return _cache!
}

export const settingsService = {
  get: load,
  invalidate() { _cache = null; _cacheAt = 0 },
}
