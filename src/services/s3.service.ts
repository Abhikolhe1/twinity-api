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
   * Use this when an external service (e.g. HeyGen) needs to download a private file.
   * @param expiresIn  Seconds until the URL expires (default: 3600 = 1 hour)
   */
  async getPresignedUrl(bucket: string, key: string, expiresIn = 3600): Promise<string> {
    const result = await buildClient()
    if (!result) return `https://stub-s3/${bucket}/${key}`
    const { client } = result
    const url = await getSignedUrl(client, new GetObjectCommand({ Bucket: bucket, Key: key }), { expiresIn })
    logger.info(`[S3] Pre-signed URL generated for key=${key} (expires in ${expiresIn}s)`)
    return url
  },

  /**
   * If the URL is an S3 URL (https://bucket.s3.region.amazonaws.com/key),
   * return a pre-signed version. Non-S3 URLs (external, seed data, empty) are
   * returned unchanged so callers don't need to check.
   */
  async presignIfS3(url: string | undefined, expiresIn = 3600): Promise<string | undefined> {
    if (!url) return url
    const match = url.match(/^https:\/\/([^.]+)\.s3\.[^.]+\.amazonaws\.com\/(.+)$/)
    if (!match) return url
    return this.getPresignedUrl(match[1], match[2], expiresIn)
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
