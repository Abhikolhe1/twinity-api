import { Router } from 'express'
import { higgsfieldWebhook } from '../controllers/webhook.controller'

const router = Router()

// Higgsfield — video generation events (register URL in Higgsfield dashboard)
router.get('/higgsfield',  (_req, res) => res.json({ success: true, service: 'twinity-higgsfield-webhook' }))
router.post('/higgsfield', higgsfieldWebhook)

export default router
