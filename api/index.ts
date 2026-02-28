import mongoose from 'mongoose'
import app from '../src/app'
import { env } from '../src/config/env'

let isConnected = false

async function ensureDb(): Promise<void> {
  if (isConnected && mongoose.connection.readyState === 1) return
  await mongoose.connect(env.mongoUri)
  isConnected = true
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export default async function handler(req: any, res: any): Promise<void> {
  await ensureDb()
  return new Promise((resolve, reject) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    app(req, res, (err: any) => {
      if (err) return reject(err)
      resolve()
    })
  })
}
