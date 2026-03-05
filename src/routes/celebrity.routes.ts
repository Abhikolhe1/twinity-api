import { Router } from 'express'
import { listCelebrities, getCelebrity, createCelebrity, updateCelebrity, toggleCelebrityStatus, deleteCelebrity } from '../controllers/celebrity.controller'
import { requireAdmin, requirePermission } from '../middleware/adminAuth'

const router = Router()

// Public
router.get('/', listCelebrities)
router.get('/:slug', getCelebrity)

// Admin
router.post('/', requireAdmin, requirePermission('celebrities.manage'), createCelebrity)
router.put('/:id', requireAdmin, requirePermission('celebrities.manage'), updateCelebrity)
router.patch('/:id/toggle', requireAdmin, requirePermission('celebrities.manage'), toggleCelebrityStatus)
router.delete('/:id', requireAdmin, requirePermission('celebrities.manage'), deleteCelebrity)

export default router
