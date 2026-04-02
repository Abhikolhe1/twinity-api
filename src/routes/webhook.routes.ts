import { Router } from 'express'
import { heygenWebhook } from '../controllers/webhook.controller'

const router = Router()

// POST /api/webhooks/heygen
// Called by HeyGen when a Talking Photo video generation job completes or fails.
// No admin auth — this is a server-to-server callback from HeyGen.
router.post('/heygen', heygenWebhook)

export default router
