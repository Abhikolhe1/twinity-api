import { Router } from 'express'
import { listRoles, createRole, updateRole, deleteRole } from '../controllers/role.controller'
import { requireAdmin, requireRole } from '../middleware/adminAuth'

const router = Router()

router.get('/', requireAdmin, requireRole('super-admin'), listRoles)
router.post('/', requireAdmin, requireRole('super-admin'), createRole)
router.put('/:id', requireAdmin, requireRole('super-admin'), updateRole)
router.delete('/:id', requireAdmin, requireRole('super-admin'), deleteRole)

export default router
