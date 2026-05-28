import { Router } from 'express'
import { requireAuth } from '../middleware/auth'
import { generateImageAd } from '../controllers/imageAd.controller'

const router = Router()

router.post('/generate', requireAuth, generateImageAd)

export default router
