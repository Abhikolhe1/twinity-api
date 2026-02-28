import mongoose from 'mongoose'
import app from '../src/app'
import { env } from '../src/config/env'

let isConnected = false

async function ensureDb(): Promise<void> {
  if (isConnected && mongoose.connection.readyState === 1) return
  await mongoose.connect(env.mongoUri, {
    serverSelectionTimeoutMS: 5000,
    connectTimeoutMS: 5000,
  })
  isConnected = true
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export default async function handler(req: any, res: any): Promise<void> {
  // Skip DB for OPTIONS preflight — CORS headers must fire without waiting for Mongo
  if (req.method !== 'OPTIONS') {
    try {
      await ensureDb()
    } catch (err) {
      res.status(503).json({
        success: false,
        message: 'Database unavailable — check MONGODB_URI environment variable',
      })
      return
    }
  }

  return new Promise((resolve, reject) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    app(req, res, (err: any) => {
      if (err) return reject(err)
      resolve()
    })
  })
}
