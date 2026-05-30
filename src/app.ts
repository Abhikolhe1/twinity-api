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
import templateRoutes     from './routes/template.routes'
import productTypeRoutes  from './routes/productType.routes'
import webhookRoutes      from './routes/webhook.routes'
import imageAdRoutes      from './routes/imageAd.routes'
import celebrityOnboardingRoutes from './routes/celebrityOnboarding.routes'
import otpRoutes          from './routes/otp.routes'
import managerLinkRoutes  from './routes/managerLink.routes'
import managerDashboardRoutes from './routes/managerDashboard.routes'
import managerRoutes      from './routes/manager.routes'

const app = express()

// Trust the first proxy (Nginx/load-balancer) so X-Forwarded-For is read correctly
// Required for express-rate-limit to identify real client IPs behind a reverse proxy
app.set('trust proxy', 1)

// ── Security ──────────────────────────────────────────────
app.use(helmet())
const allowedOrigins = [env.cors.clientUrl, env.cors.adminUrl]

app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true)
    if (allowedOrigins.includes(origin)) return callback(null, true)
    callback(new Error(`CORS: origin ${origin} not allowed`))
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}))

// ── Body parsing ──────────────────────────────────────────
// The verify callback stores the raw buffer on req so webhook handlers
// can verify HMAC signatures (e.g. Sync.so Sync-Signature header).
app.use(express.json({
  limit: '10mb',
  verify: (req: any, _res, buf) => { req.rawBody = buf },
}))
app.use(express.urlencoded({ extended: true }))

// ── Webhooks (before rate-limit — server-to-server callbacks) ─────────────
app.use('/api/webhooks', webhookRoutes)

// ── Rate limiting ─────────────────────────────────────────
app.use('/api/', rateLimit({
  windowMs: env.rateLimit.windowMs,
  max: env.rateLimit.max,
  skip: (req) => req.path.startsWith('/admin') || req.path.startsWith('/manager'),
  message: { success: false, message: 'Too many requests, please try again later.' },
}))

app.use('/api/admin', rateLimit({
  windowMs: env.rateLimit.adminWindowMs,
  max: env.rateLimit.adminMax,
  message: { success: false, message: 'Too many admin requests, please try again shortly.' },
}))

app.use('/api/manager', rateLimit({
  windowMs: env.rateLimit.adminWindowMs,
  max: env.rateLimit.adminMax,
  message: { success: false, message: 'Too many manager requests, please try again shortly.' },
}))

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
app.use('/api/templates',     templateRoutes)
app.use('/api/product-types', productTypeRoutes)
app.use('/api/image-ads',     imageAdRoutes)
app.use('/api/celebrity-onboarding', celebrityOnboardingRoutes)
app.use('/api/otp',                  otpRoutes)
app.use('/api/admin/celebrity-managers', managerLinkRoutes)
app.use('/api/manager',              managerRoutes)
app.use('/api/manager/dashboard',    managerDashboardRoutes)

// ── 404 ───────────────────────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({ success: false, message: 'Route not found' })
})

// ── Error handler ─────────────────────────────────────────
app.use(errorHandler)

export default app
