import { Router } from 'express'
import { creatifyWebhook, falWebhook, testWatermark } from '../controllers/webhook.controller'

const router = Router()

// fal.ai — image/video generation events
router.get('/fal',  (_req, res) => res.json({ success: true, service: 'twinity-fal-webhook' }))
router.post('/fal', falWebhook)

// Creatify Aurora — avatar video generation events (legacy)
router.get('/creatify',  (_req, res) => res.json({ success: true, service: 'twinity-creatify-webhook' }))
router.post('/creatify', creatifyWebhook)

// DEV: watermark smoke-test — POST { videoUrl } or { referenceId }
router.post('/test-watermark', testWatermark)

export default router
