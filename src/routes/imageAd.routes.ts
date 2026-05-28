import { Router } from 'express'
import { requireAuth } from '../middleware/auth'
import { generateImageAd, retryImageAd } from '../controllers/imageAd.controller'

const router = Router()

router.post('/generate', requireAuth, generateImageAd)
router.post('/:referenceId/retry', requireAuth, retryImageAd)

export default router
