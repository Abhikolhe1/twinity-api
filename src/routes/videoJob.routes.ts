import { Router } from 'express'
import {
  createJob,
  previewVoice,
  getMyJobs,
  getMyStats,
  getJob,
  cancelJob,
  submitBookCall,
  improveScript,
  suggestScenePrompts,
  generateImage,
  uploadAsset,
  getJobDownloadUrl,
  adminListJobs,
  adminUpdateJobStatus,
  adminEnableDownload,
  adminApproveJob,
  adminRejectJob,
  validateSubmissionRequest,
  clientApprovePreview,
  clientRequestRevision,
  clientEscalateToSupport,
  clientGetRevisions,
  adminGetAllRevisions,
  adminSetPreviewUrl,
  celebrityApproveJob,
  celebrityRejectJob,
  managerApproveJob,
  managerRejectJob,
} from '../controllers/videoJob.controller'
import {
  requestRefund,
  listRefundRequests,
  getRefundRequest,
  approveRefundRequest,
  rejectRefundRequest,
  processRefundRequest,
} from '../controllers/refund.controller'
import { requireAuth } from '../middleware/auth'
import { requireAdmin, requirePermission } from '../middleware/adminAuth'
import { requireManager } from '../middleware/managerAuth'
import { listMyCelebrityJobs } from '../controllers/celebrityOnboarding.controller'

const router = Router()

// Customer routes
router.post('/', requireAuth, createJob)
router.post('/validate-submission', requireAuth, validateSubmissionRequest)
router.post('/preview-voice', requireAuth, previewVoice)
router.post('/improve-script', requireAuth, improveScript)
router.post('/scene-prompts', requireAuth, suggestScenePrompts)
router.post('/generate-image', requireAuth, generateImage)
router.post('/upload-asset', requireAuth, uploadAsset)
router.get('/my/stats', requireAuth, getMyStats)
router.get('/my', requireAuth, getMyJobs)
router.get('/my/:referenceId', requireAuth, getJob)
router.post('/my/:referenceId/book-call', requireAuth, submitBookCall)
router.post('/my/:referenceId/cancel', requireAuth, cancelJob)
router.post('/my/:referenceId/refund', requireAuth, requestRefund)
router.get('/my/:referenceId/download-url', requireAuth, getJobDownloadUrl)

// TWIN-50: Preview & Revision routes
router.post('/my/:referenceId/approve-preview', requireAuth, clientApprovePreview)
router.post('/my/:referenceId/request-revision', requireAuth, clientRequestRevision)
router.post('/my/:referenceId/escalate-to-support', requireAuth, clientEscalateToSupport)
router.get('/my/:referenceId/revisions', requireAuth, clientGetRevisions)

router.get('/celebrity/my', requireAdmin, requirePermission('celebrity.orders.view'), listMyCelebrityJobs)
router.post('/celebrity/my/:id/approve', requireAdmin, requirePermission('celebrity.orders.view'), celebrityApproveJob)
router.post('/celebrity/my/:id/reject', requireAdmin, requirePermission('celebrity.orders.view'), celebrityRejectJob)
router.post('/manager/:id/approve', requireManager, managerApproveJob)
router.post('/manager/:id/reject', requireManager, managerRejectJob)

// Admin routes
router.get('/admin', requireAdmin, requirePermission('videos.view'), adminListJobs)
router.get('/admin/revisions', requireAdmin, requirePermission('videos.view'), adminGetAllRevisions)
router.patch('/admin/:id/status', requireAdmin, requirePermission('videos.manage'), adminUpdateJobStatus)
router.post('/admin/:id/set-preview', requireAdmin, requirePermission('videos.manage'), adminSetPreviewUrl)
router.post('/admin/:id/approve', requireAdmin, requirePermission('videos.manage'), adminApproveJob)
router.post('/admin/:id/reject', requireAdmin, requirePermission('videos.manage'), adminRejectJob)
router.patch('/admin/:id/enable-download', requireAdmin, requirePermission('videos.manage'), adminEnableDownload)
router.get('/admin/refunds', requireAdmin, requirePermission('videos.view'), listRefundRequests)
router.get('/admin/refunds/:id', requireAdmin, requirePermission('videos.view'), getRefundRequest)
router.post('/admin/refunds/:id/approve', requireAdmin, requirePermission('videos.manage'), approveRefundRequest)
router.post('/admin/refunds/:id/reject', requireAdmin, requirePermission('videos.manage'), rejectRefundRequest)
router.post('/admin/refunds/:id/process', requireAdmin, requirePermission('videos.manage'), processRefundRequest)

export default router
