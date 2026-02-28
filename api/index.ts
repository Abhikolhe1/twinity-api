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

function getAllowedOrigins(): string[] {
  // Primary: CORS_ORIGINS comma-separated list
  const raw = process.env.CORS_ORIGINS || ''
  const list = raw.split(',').map(s => s.trim()).filter(Boolean)
  if (list.length > 0) return list

  // Fallback: individual CLIENT_URL / ADMIN_URL env vars
  const fallback: string[] = []
  if (process.env.CLIENT_URL) fallback.push(process.env.CLIENT_URL)
  if (process.env.ADMIN_URL)  fallback.push(process.env.ADMIN_URL)
  return fallback
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function applyCors(req: any, res: any): boolean {
  const origin: string | undefined = req.headers['origin']
  const allowed = getAllowedOrigins()

  // Non-browser requests (curl, server-to-server) have no Origin header — always allow
  if (!origin) return true

  if (allowed.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin)
    res.setHeader('Vary', 'Origin')
    res.setHeader('Access-Control-Allow-Credentials', 'true')
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization')
    return true
  }

  // Origin not allowed — return explicit 403 with a diagnostic message
  res.status(403).json({
    success: false,
    message: `CORS: origin '${origin}' is not allowed. Set CORS_ORIGINS in Vercel env vars.`,
    allowed,
  })
  return false
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export default async function handler(req: any, res: any): Promise<void> {
  // 1. Apply CORS headers immediately — before DB, before Express
  const corsOk = applyCors(req, res)

  // 2. OPTIONS preflight: respond with 204 immediately, no DB or Express needed
  if (req.method === 'OPTIONS') {
    if (corsOk) res.status(204).end()
    return
  }

  // 3. Origin was rejected — response already sent
  if (!corsOk) return

  // 4. Connect to MongoDB
  try {
    await ensureDb()
  } catch {
    res.status(503).json({
      success: false,
      message: 'Database unavailable — ensure MONGODB_URI is set in Vercel environment variables',
    })
    return
  }

  // 5. Forward to Express for all business logic
  return new Promise((resolve, reject) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    app(req, res, (err: any) => {
      if (err) return reject(err)
      resolve()
    })
  })
}
