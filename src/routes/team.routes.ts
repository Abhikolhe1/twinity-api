import { Router } from 'express'
import {
  listTeamMembers,
  getTeamMember,
  createTeamMember,
  updateTeamMember,
  deleteTeamMember,
} from '../controllers/team.controller'
import { requireAdmin, requireRole } from '../middleware/adminAuth'

const router = Router()

router.get('/', requireAdmin, requireRole('super-admin'), listTeamMembers)
router.get('/:id', requireAdmin, requireRole('super-admin'), getTeamMember)
router.post('/', requireAdmin, requireRole('super-admin'), createTeamMember)
router.put('/:id', requireAdmin, requireRole('super-admin'), updateTeamMember)
router.delete('/:id', requireAdmin, requireRole('super-admin'), deleteTeamMember)

export default router
