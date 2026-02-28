import winston from 'winston'
import { env } from './env'

export const logger = winston.createLogger({
  level: env.nodeEnv === 'production' ? 'info' : 'debug',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    env.nodeEnv === 'production'
      ? winston.format.json()
      : winston.format.combine(
          winston.format.colorize(),
          winston.format.printf(({ timestamp, level, message, ...meta }) => {
            const metaStr = Object.keys(meta).length ? JSON.stringify(meta, null, 2) : ''
            return `${timestamp} [${level}]: ${message} ${metaStr}`
          })
        )
  ),
  // Serverless (Vercel) has a read-only filesystem — Console only.
  // Vercel captures stdout/stderr and surfaces them in the deployment logs.
  transports: [new winston.transports.Console()],
})
