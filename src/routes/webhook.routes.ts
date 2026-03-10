import { Router } from 'express'
import { higgsfieldWebhook } from '../controllers/webhook.controller'

const router = Router()

// POST /api/webhooks/higgsfield
// Called by Higgsfield when an avatar training or video render job completes/fails.
// No admin auth — this is a server-to-server callback from Higgsfield.
router.post('/higgsfield', higgsfieldWebhook)

export default router
