import { Router } from 'express'
import { creatifyWebhook, testWatermark } from '../controllers/webhook.controller'

const router = Router()

// Creatify Aurora — avatar video generation events
router.get('/creatify',  (_req, res) => res.json({ success: true, service: 'twinity-creatify-webhook' }))
router.post('/creatify', creatifyWebhook)

// DEV: watermark smoke-test — POST { videoUrl } or { referenceId }
router.post('/test-watermark', testWatermark)

export default router
