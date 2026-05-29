import { Router } from 'express'
import { requireAdmin, requirePermission } from '../middleware/adminAuth'
import {
  listManagerLinks,
  createManagerLink,
  updateManagerLink,
  deleteManagerLink,
  listAllManagerLinks,
  listManagers,
  createManagerAndBulkLink,
} from '../controllers/managerLink.controller'

const router = Router()

router.get('/', requireAdmin, requirePermission('celebrity_managers.view'), listAllManagerLinks)
router.get('/managers', requireAdmin, requirePermission('celebrity_managers.view'), listManagers)
router.post('/managers', requireAdmin, requirePermission('celebrity_managers.manage'), createManagerAndBulkLink)
router.get('/:celebrity_id/managers', requireAdmin, requirePermission('celebrity_managers.view'), listManagerLinks)
router.post('/:celebrity_id/managers', requireAdmin, requirePermission('celebrity_managers.manage'), createManagerLink)
router.patch('/:celebrity_id/managers/:link_id', requireAdmin, requirePermission('celebrity_managers.manage'), updateManagerLink)
router.delete('/:celebrity_id/managers/:link_id', requireAdmin, requirePermission('celebrity_managers.manage'), deleteManagerLink)

export default router
