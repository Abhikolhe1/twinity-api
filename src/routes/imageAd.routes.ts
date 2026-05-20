import { Router } from 'express'
import { requireAuth } from '../middleware/auth'
import { generateVideoAd } from '../controllers/imageAd.controller'

const router = Router()

router.post('/generate', requireAuth, generateVideoAd)

export default router
