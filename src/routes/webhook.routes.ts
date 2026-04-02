import { Router } from 'express'
import { heygenWebhook } from '../controllers/webhook.controller'

const router = Router()

// GET  /api/webhooks/heygen — HeyGen pings this to verify the URL is reachable
// POST /api/webhooks/heygen — HeyGen sends event payloads here
router.get('/heygen',  (_req, res) => res.json({ success: true, service: 'twinity-heygen-webhook' }))
router.post('/heygen', heygenWebhook)

export default router
