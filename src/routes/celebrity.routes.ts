import { Router } from 'express'
import multer from 'multer'
import { listCelebrities, getCelebrity, createCelebrity, updateCelebrity, toggleCelebrityStatus, deleteCelebrity, cloneCelebrityVoice } from '../controllers/celebrity.controller'
import { requireAdmin, requirePermission } from '../middleware/adminAuth'

const router = Router()

// Multer for voice cloning: up to 25 audio samples (50 MB each)
const voiceUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
}).fields([
  { name: 'audio', maxCount: 25 },
])

// Public
router.get('/', listCelebrities)
router.get('/:slug', getCelebrity)

// Admin
router.post('/', requireAdmin, requirePermission('celebrities.manage'), createCelebrity)
router.put('/:id', requireAdmin, requirePermission('celebrities.manage'), updateCelebrity)
router.patch('/:id/toggle', requireAdmin, requirePermission('celebrities.manage'), toggleCelebrityStatus)
router.post('/:id/clone-voice', requireAdmin, requirePermission('celebrities.manage'), voiceUpload, cloneCelebrityVoice)
router.delete('/:id', requireAdmin, requirePermission('celebrities.manage'), deleteCelebrity)

export default router
