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

const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true)
    else cb(new Error('Only image files are allowed'))
  },
}).single('image')

// Public — used by the customer wizard
router.get('/', listTemplates)

// Admin
router.get('/admin',           requireAdmin, requirePermission('templates.view'),   adminListTemplates)
router.post('/upload-image',   requireAdmin, requirePermission('templates.manage'), imageUpload, uploadTemplateImage)
router.post('/',               requireAdmin, requirePermission('templates.manage'), createTemplate)
router.put('/:id',             requireAdmin, requirePermission('templates.manage'), updateTemplate)
router.patch('/:id/toggle',    requireAdmin, requirePermission('templates.manage'), toggleTemplateStatus)
router.delete('/:id',          requireAdmin, requirePermission('templates.manage'), deleteTemplate)

export default router
