import { Router } from 'express'
import {
  listProductTypes,
  adminListProductTypes,
  createProductType,
  updateProductType,
  toggleProductType,
  deleteProductType,
} from '../controllers/productType.controller'
import { requireAdmin, requirePermission } from '../middleware/adminAuth'

const router = Router()

// Admin must come before /:slug to avoid slug-matching 'admin'
router.get('/admin', requireAdmin, adminListProductTypes)

// Public — used by the customer wizard (prompts excluded)
router.get('/', listProductTypes)

// Admin CRUD
router.post('/',          requireAdmin, requirePermission('settings.manage'), createProductType)
router.put('/:id',        requireAdmin, requirePermission('settings.manage'), updateProductType)
router.patch('/:id/toggle', requireAdmin, requirePermission('settings.manage'), toggleProductType)
router.delete('/:id',     requireAdmin, requirePermission('settings.manage'), deleteProductType)

export default router
