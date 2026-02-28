import type { VercelRequest, VercelResponse } from '@vercel/node'
import mongoose from 'mongoose'
import app from '../src/app'
import { env } from '../src/config/env'

// Cache connection across warm invocations
let isConnected = false

async function ensureDb(): Promise<void> {
  if (isConnected && mongoose.connection.readyState === 1) return
  await mongoose.connect(env.mongoUri)
  isConnected = true
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  await ensureDb()
  return new Promise((resolve, reject) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    app(req as any, res as any, (err: unknown) => {
      if (err) return reject(err)
      resolve()
    })
  })
}
