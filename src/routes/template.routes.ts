import { Router } from 'express'
import multer from 'multer'
import {
  listTemplates,
  adminListTemplates,
  createTemplate,
  updateTemplate,
  toggleTemplateStatus,
  deleteTemplate,
  uploadTemplateImage,
} from '../controllers/template.controller'
import { requireAdmin, requirePermission } from '../middleware/adminAuth'

const router = Router()
const templateImageUpload = multer({ storage: multer.memoryStorage() })

// Public — used by the customer wizard
router.get('/', listTemplates)

// Admin
router.get('/admin', requireAdmin, requirePermission('templates.view'), adminListTemplates)
router.post('/upload-image', requireAdmin, requirePermission('templates.manage'), templateImageUpload.single('image'), uploadTemplateImage)
router.post('/',     requireAdmin, requirePermission('templates.manage'), createTemplate)
router.put('/:id',   requireAdmin, requirePermission('templates.manage'), updateTemplate)
router.patch('/:id/toggle', requireAdmin, requirePermission('templates.manage'), toggleTemplateStatus)
router.delete('/:id', requireAdmin, requirePermission('templates.manage'), deleteTemplate)

export default router
