import { Router } from 'express'
import { listRoles, createRole, updateRole, deleteRole } from '../controllers/role.controller'
import { requireAdmin, requirePermission } from '../middleware/adminAuth'

const router = Router()

router.get('/', requireAdmin, requirePermission('roles.view'), listRoles)
router.post('/', requireAdmin, requirePermission('roles.manage'), createRole)
router.put('/:id', requireAdmin, requirePermission('roles.manage'), updateRole)
router.delete('/:id', requireAdmin, requirePermission('roles.manage'), deleteRole)

export default router
