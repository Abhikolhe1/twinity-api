import { Router } from 'express'
import { creatifyWebhook } from '../controllers/webhook.controller'

const router = Router()

// Creatify Aurora — avatar video generation events
router.get('/creatify',  (_req, res) => res.json({ success: true, service: 'twinity-creatify-webhook' }))
router.post('/creatify', creatifyWebhook)

export default router
