import { Router } from 'express'
import multer from 'multer'
import { listCelebrities, getCelebrity, createCelebrity, updateCelebrity, toggleCelebrityStatus, deleteCelebrity, createCelebrityAvatar } from '../controllers/celebrity.controller'
import { requireAdmin, requirePermission } from '../middleware/adminAuth'

const router = Router()

// Multer: memory storage, max 80 images (10 MB each) + 1 audio (100 MB)
const avatarUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024 }, // 100 MB per file
}).fields([
  { name: 'images', maxCount: 80 },
  { name: 'audio',  maxCount: 1  },
])

// Public
router.get('/', listCelebrities)
router.get('/:slug', getCelebrity)

// Admin
router.post('/', requireAdmin, requirePermission('celebrities.manage'), createCelebrity)
router.put('/:id', requireAdmin, requirePermission('celebrities.manage'), updateCelebrity)
router.patch('/:id/toggle', requireAdmin, requirePermission('celebrities.manage'), toggleCelebrityStatus)
router.post('/:id/create-avatar', requireAdmin, requirePermission('celebrities.manage'), avatarUpload, createCelebrityAvatar)
router.delete('/:id', requireAdmin, requirePermission('celebrities.manage'), deleteCelebrity)

export default router
