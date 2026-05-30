/**
 * S3 Service — upload buffers to AWS S3.
 * Credentials and bucket names are loaded from the Settings DB (via settingsService).
 * Falls back to env vars if not configured in DB.
 * Stubs when no credentials are available.
 */
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { settingsService } from './settings.service'
import { logger } from '../config/logger'

async function buildClient(): Promise<{ client: S3Client; region: string } | null> {
  const { awsAccessKeyId, awsSecretAccessKey, awsRegion } = await settingsService.get()
  if (!awsAccessKeyId || !awsSecretAccessKey) return null
  return {
    client: new S3Client({
      region: awsRegion,
      credentials: {
        accessKeyId:     awsAccessKeyId,
        secretAccessKey: awsSecretAccessKey,
      },
    }),
    region: awsRegion,
  }
}

export interface UploadResult {
  url: string
  key: string
  stub: boolean
}

// ── S3 URL parser ─────────────────────────────────────────────────────────────
function parseS3Url(url: string): { bucket: string; key: string } | null {
  const raw   = url.includes('?') ? url.split('?')[0] : url
  const match = raw.match(/^https:\/\/([^.]+)\.s3\.[^.]+\.amazonaws\.com\/(.+)$/)
  if (!match) return null
  return { bucket: match[1], key: match[2] }
}

// ── Presign cache ─────────────────────────────────────────────────────────────
// Key: raw S3 URL (no query params).  Value: { signedUrl, expiresAt (ms epoch) }.
// Entries are evicted 5 minutes before the signed URL expires so clients
// always receive a URL with meaningful remaining lifetime.
const PRESIGN_TTL    = 86_400        // 24 hours — how long we ask AWS to honour the URL
const PRESIGN_BUFFER = 300_000       // 5 minutes in ms — evict this early

interface CacheEntry { signedUrl: string; expiresAt: number }
const presignCache = new Map<string, CacheEntry>()

export const s3Service = {
  /**
   * Upload a single file buffer to S3.
   * @param bucket  S3 bucket name
   * @param key     Object key (path inside bucket)
   * @param buffer  File data
   * @param mimeType  Content-Type for the uploaded object
   */
  async upload(
    bucket: string,
    key: string,
    buffer: Buffer,
    mimeType: string,
  ): Promise<UploadResult> {
    const result = await buildClient()

    if (!result) {
      logger.warn(`[S3] Credentials not configured — stub upload for key=${key}`)
      return {
        url:  `https://stub-s3/${bucket}/${key}`,
        key,
        stub: true,
      }
    }

    const { client, region } = result

    await client.send(new PutObjectCommand({
      Bucket:      bucket,
      Key:         key,
      Body:        buffer,
      ContentType: mimeType,
    }))

    const url = `https://${bucket}.s3.${region}.amazonaws.com/${key}`
    logger.info(`[S3] Uploaded: ${url}`)
    return { url, key, stub: false }
  },

  /**
   * Generate a pre-signed URL for a private S3 object.
   * Pass expiresIn only for short-lived one-off URLs (e.g. audio for Creatify).
   * For long-lived display URLs prefer presignIfS3() which handles caching.
   */
  async getPresignedUrl(bucket: string, key: string, expiresIn = PRESIGN_TTL): Promise<string> {
    const result = await buildClient()
    if (!result) return `https://stub-s3/${bucket}/${key}`
    const { client } = result
    const url = await getSignedUrl(client, new GetObjectCommand({ Bucket: bucket, Key: key }), { expiresIn })
    logger.info(`[S3] Pre-signed URL generated for key=${key} (expires in ${expiresIn}s)`)
    return url
  },

  /**
   * If the URL is an S3 URL, return a cached presigned version.
   * The signed URL is generated with a 24-hour TTL and reused for all
   * requests until 5 minutes before expiry, so clients never receive a
   * near-expired URL even when they cache the response for hours.
   *
   * Non-S3 URLs (external links, seed data, empty strings) pass through unchanged.
   */
  async presignIfS3(url: string | undefined): Promise<string | undefined> {
    if (!url) return url

    // Strip any existing query string so the raw URL is used as cache key
    const rawUrl  = url.includes('?') ? url.split('?')[0] : url
    const parsed  = parseS3Url(rawUrl)
    if (!parsed) return url   // not an S3 URL — return as-is

    // No S3 credentials — return the base S3 URL (no query string) so video
    // players can still load it on public buckets, and expired presigned query
    // strings are not passed through.
    const s3 = await buildClient()
    if (!s3) return rawUrl

    const cached = presignCache.get(rawUrl)
    if (cached && cached.expiresAt - Date.now() > PRESIGN_BUFFER) {
      return cached.signedUrl
    }

    const { bucket, key } = parsed
    const signedUrl = await getSignedUrl(s3.client, new GetObjectCommand({ Bucket: bucket, Key: key }), { expiresIn: PRESIGN_TTL })
    logger.info(`[S3] Pre-signed URL (cached) generated for key=${key}`)
    presignCache.set(rawUrl, { signedUrl, expiresAt: Date.now() + PRESIGN_TTL * 1000 })
    return signedUrl
  },

  /**
   * Generate a short-lived presigned URL that forces browser download.
   * Sets ResponseContentDisposition so S3 returns Content-Disposition: attachment.
   */
  async getDownloadPresignedUrl(bucket: string, key: string, filename: string, expiresIn = 300): Promise<string | null> {
    const result = await buildClient()
    if (!result) return null
    const { client } = result
    const url = await getSignedUrl(
      client,
      new GetObjectCommand({
        Bucket: bucket,
        Key: key,
        ResponseContentDisposition: `attachment; filename="${filename}"`,
      }),
      { expiresIn },
    )
    return url
  },

  /**
   * One-off short-lived presigned URL — bypasses the long-lived cache.
   * Use this when an external service must download the file within a known
   * short window (e.g. Creatify Aurora needs the image for ~2 hours).
   */
  async presignIfS3Short(url: string | undefined, expiresIn: number): Promise<string | undefined> {
    if (!url) return url
    const parsed = parseS3Url(url)
    if (!parsed) return url
    const s3 = await buildClient()
    if (!s3) return url
    return getSignedUrl(s3.client, new GetObjectCommand({ Bucket: parsed.bucket, Key: parsed.key }), { expiresIn })
  },

  /**
   * Upload multiple images and one audio file for a celebrity.
   * Bucket name is pulled from the Settings DB (s3AssetsBucket).
   *
   * Folder structure:
   *   celebrities/{slug}/training-images/{filename}
   *   celebrities/{slug}/audio/{filename}
   */
  async uploadCelebrityAssets(params: {
    slug: string
    images: Array<{ originalname: string; buffer: Buffer; mimetype: string }>
    audio?: { originalname: string; buffer: Buffer; mimetype: string } | null
  }): Promise<{ imageUrls: string[]; audioUrl: string | null }> {
    const { s3Bucket } = await settingsService.get()
    const s3AssetsBucket = s3Bucket

    const imageResults = await Promise.all(
      params.images.map((img, i) => {
        const ext = img.originalname.split('.').pop() || 'jpg'
        const key = `celebrities/${params.slug}/training-images/${i + 1}.${ext}`
        return s3Service.upload(s3AssetsBucket, key, img.buffer, img.mimetype)
      }),
    )

    let audioUrl: string | null = null
    if (params.audio) {
      const ext = params.audio.originalname.split('.').pop() || 'mp3'
      const key = `celebrities/${params.slug}/audio/voice.${ext}`
      const r = await s3Service.upload(s3AssetsBucket, key, params.audio.buffer, params.audio.mimetype)
      audioUrl = r.url
    }

    return {
      imageUrls: imageResults.map(r => r.url),
      audioUrl,
    }
  },
}
