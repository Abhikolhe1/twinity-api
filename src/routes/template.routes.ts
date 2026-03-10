import { Router } from 'express'
import {
  listTemplates,
  adminListTemplates,
  createTemplate,
  updateTemplate,
  toggleTemplateStatus,
  deleteTemplate,
} from '../controllers/template.controller'
import { requireAdmin, requirePermission } from '../middleware/adminAuth'

const router = Router()

// Public — used by the customer wizard
router.get('/', listTemplates)

// Admin
router.get('/admin', requireAdmin, requirePermission('templates.view'), adminListTemplates)
router.post('/',     requireAdmin, requirePermission('templates.manage'), createTemplate)
router.put('/:id',   requireAdmin, requirePermission('templates.manage'), updateTemplate)
router.patch('/:id/toggle', requireAdmin, requirePermission('templates.manage'), toggleTemplateStatus)
router.delete('/:id', requireAdmin, requirePermission('templates.manage'), deleteTemplate)

export default router
