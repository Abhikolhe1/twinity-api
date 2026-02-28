import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import morgan from 'morgan'
import rateLimit from 'express-rate-limit'

import { env } from './config/env'
import { errorHandler } from './middleware/errorHandler'

import authRoutes       from './routes/auth.routes'
import celebrityRoutes  from './routes/celebrity.routes'
import videoJobRoutes   from './routes/videoJob.routes'
import leadRoutes       from './routes/lead.routes'
import adminRoutes      from './routes/admin.routes'
import roleRoutes       from './routes/role.routes'
import teamRoutes       from './routes/team.routes'
import templateRoutes   from './routes/template.routes'

const app = express()

// ── Security ──────────────────────────────────────────────
app.use(helmet())
app.use(cors({
  origin: [env.cors.clientUrl, env.cors.adminUrl],
  credentials: true,
}))

// ── Rate limiting ─────────────────────────────────────────
app.use('/api/', rateLimit({
  windowMs: env.rateLimit.windowMs,
  max: env.rateLimit.max,
  message: { success: false, message: 'Too many requests, please try again later.' },
}))

// ── Body parsing ──────────────────────────────────────────
app.use(express.json({ limit: '10mb' }))
app.use(express.urlencoded({ extended: true }))

// ── Logging ───────────────────────────────────────────────
app.use(morgan(env.nodeEnv === 'production' ? 'combined' : 'dev'))

// ── Health check ──────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({ success: true, service: 'twinity-api', version: '1.0.0', timestamp: new Date().toISOString() })
})

// ── Routes ────────────────────────────────────────────────
app.use('/api/auth',        authRoutes)
app.use('/api/celebrities', celebrityRoutes)
app.use('/api/jobs',        videoJobRoutes)
app.use('/api/leads',       leadRoutes)
app.use('/api/admin',       adminRoutes)
app.use('/api/admin/roles', roleRoutes)
app.use('/api/admin/team',  teamRoutes)
app.use('/api/templates',   templateRoutes)

// ── 404 ───────────────────────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({ success: false, message: 'Route not found' })
})

// ── Error handler ─────────────────────────────────────────
app.use(errorHandler)

export default app
