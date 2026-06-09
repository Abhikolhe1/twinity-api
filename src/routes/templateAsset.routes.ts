import { Router } from 'express'
import { requireAdmin, requirePermission } from '../middleware/adminAuth'
import { listTemplateAssets, generateAsset, uploadAsset, deleteAsset, getCompositeForPair, updateAssetTtsModel } from '../controllers/templateAsset.controller'

const router = Router()

router.get('/composite',  getCompositeForPair)
router.get('/',           requireAdmin,                                        listTemplateAssets)
router.post('/generate',  requireAdmin, requirePermission('templates.manage'), generateAsset)
router.post('/upload',    requireAdmin, requirePermission('templates.manage'), uploadAsset)
router.patch('/:id/tts-model', requireAdmin, requirePermission('templates.manage'), updateAssetTtsModel)
router.delete('/:id',          requireAdmin, requirePermission('templates.manage'), deleteAsset)

export default router
