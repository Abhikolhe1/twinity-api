import app from '../src/app'
import prisma from '../src/lib/prisma'

let isConnected = false

async function ensureDb(): Promise<void> {
  if (isConnected) return
  await prisma.$connect()
  isConnected = true
}

function getAllowedOrigins(): string[] {
  const origins: string[] = []
  if (process.env.CLIENT_URL) origins.push(process.env.CLIENT_URL)
  if (process.env.ADMIN_URL)  origins.push(process.env.ADMIN_URL)
  return origins
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function applyCors(req: any, res: any): boolean {
  const origin: string | undefined = req.headers['origin']
  const allowed = getAllowedOrigins()

  if (!origin) return true

  if (allowed.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin)
    res.setHeader('Vary', 'Origin')
    res.setHeader('Access-Control-Allow-Credentials', 'true')
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization')
    return true
  }

  res.status(403).json({ success: false, message: `CORS: origin '${origin}' is not allowed.`, allowed })
  return false
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export default async function handler(req: any, res: any): Promise<void> {
  const corsOk = applyCors(req, res)

  if (req.method === 'OPTIONS') {
    if (corsOk) res.status(204).end()
    return
  }

  if (!corsOk) return

  try {
    await ensureDb()
  } catch {
    res.status(503).json({ success: false, message: 'Database unavailable — ensure DATABASE_URL is set in environment variables' })
    return
  }

  return new Promise((resolve, reject) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    app(req, res, (err: any) => {
      if (err) return reject(err)
      resolve()
    })
  })
}
