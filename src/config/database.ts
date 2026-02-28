import mongoose from 'mongoose'
import { env } from './env'
import { logger } from './logger'

export async function connectDatabase(): Promise<void> {
  try {
    await mongoose.connect(env.mongoUri, {
      serverSelectionTimeoutMS: 5000,
    })
    logger.info('MongoDB connected successfully')
  } catch (err) {
    logger.error('MongoDB connection failed:', err)
    process.exit(1)
  }
}

mongoose.connection.on('disconnected', () => {
  logger.warn('MongoDB disconnected')
})
