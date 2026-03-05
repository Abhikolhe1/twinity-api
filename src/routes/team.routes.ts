import { Router } from 'express'
import {
  listTeamMembers,
  getTeamMember,
  createTeamMember,
  updateTeamMember,
  deleteTeamMember,
} from '../controllers/team.controller'
import { requireAdmin, requirePermission } from '../middleware/adminAuth'

const router = Router()

router.get('/', requireAdmin, requirePermission('team.view'), listTeamMembers)
router.get('/:id', requireAdmin, requirePermission('team.view'), getTeamMember)
router.post('/', requireAdmin, requirePermission('team.manage'), createTeamMember)
router.put('/:id', requireAdmin, requirePermission('team.manage'), updateTeamMember)
router.delete('/:id', requireAdmin, requirePermission('team.manage'), deleteTeamMember)

export default router
