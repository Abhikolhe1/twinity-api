import { Router } from 'express'
import { higgsfieldWebhook, syncLabsWebhook } from '../controllers/webhook.controller'

const router = Router()

// Higgsfield — animated video generation events
router.get('/higgsfield',  (_req, res) => res.json({ success: true, service: 'twinity-higgsfield-webhook' }))
router.post('/higgsfield', higgsfieldWebhook)

// Sync.so — lip-sync completion events
router.get('/synclabs',  (_req, res) => res.json({ success: true, service: 'twinity-synclabs-webhook' }))
router.post('/synclabs', syncLabsWebhook)

export default router
