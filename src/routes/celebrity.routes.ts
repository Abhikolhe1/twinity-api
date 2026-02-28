import { Router } from 'express'
import { listCelebrities, getCelebrity, createCelebrity, updateCelebrity, toggleCelebrityStatus, deleteCelebrity } from '../controllers/celebrity.controller'
import { requireAdmin, requireRole } from '../middleware/adminAuth'

const router = Router()

// Public
router.get('/', listCelebrities)
router.get('/:slug', getCelebrity)

// Admin
router.post('/', requireAdmin, requireRole('super-admin', 'admin'), createCelebrity)
router.put('/:id', requireAdmin, requireRole('super-admin', 'admin'), updateCelebrity)
router.patch('/:id/toggle', requireAdmin, requireRole('super-admin', 'admin'), toggleCelebrityStatus)
router.delete('/:id', requireAdmin, requireRole('super-admin'), deleteCelebrity)

export default router
