import { Router } from 'express'
import { falWebhook } from '../controllers/webhook.controller'

const router = Router()

// fal.ai Seedance 2.0 — video generation events
router.get('/fal',  (_req, res) => res.json({ success: true, service: 'twinity-fal-webhook' }))
router.post('/fal', falWebhook)

export default router
