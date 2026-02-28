import dotenv from 'dotenv'
dotenv.config()

export const env = {
  port: parseInt(process.env.PORT || '4000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  mongoUri: process.env.MONGODB_URI || 'mongodb://localhost:27017/twinity',
  jwt: {
    secret: process.env.JWT_SECRET || 'dev_jwt_secret',
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
    refreshSecret: process.env.JWT_REFRESH_SECRET || 'dev_refresh_secret',
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '30d',
  },
  adminJwtSecret: process.env.ADMIN_JWT_SECRET || 'dev_admin_secret',
  aws: {
    region: process.env.AWS_REGION || 'us-east-1',
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
    s3Buckets: {
      videos: process.env.S3_BUCKET_VIDEOS || 'twinity-videos',
      assets: process.env.S3_BUCKET_ASSETS || 'twinity-assets',
    },
  },
  ses: {
    fromEmail: process.env.SES_FROM_EMAIL || 'no-reply@twinity.ai',
    adminEmail: process.env.ADMIN_EMAIL || 'admin@twinity.ai',
  },
  redis: {
    url: process.env.REDIS_URL || 'redis://localhost:6379',
  },
  externalApis: {
    elevenLabs: process.env.ELEVENLABS_API_KEY || '',
    syncLabs: process.env.SYNCLABS_API_KEY || '',
    higgsfield: process.env.HIGGSFIELD_API_KEY || '',
  },
  cors: {
    clientUrl: process.env.CLIENT_URL || 'http://localhost:3000',
    adminUrl: process.env.ADMIN_URL || 'http://localhost:3001',
    // CORS_ORIGINS overrides both — comma-separated list for production
    // e.g. "https://twinity-web-app.vercel.app,https://twinity-admin.vercel.app"
    origins: process.env.CORS_ORIGINS
      ? process.env.CORS_ORIGINS.split(',').map(s => s.trim()).filter(Boolean)
      : null,
  },
  rateLimit: {
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000', 10),
    max: parseInt(process.env.RATE_LIMIT_MAX || '100', 10),
  },
}
