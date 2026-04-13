import { Router } from 'express'
import { createJob, getMyJobs, getMyStats, getJob, cancelJob, submitBookCall, improveScript, suggestScenePrompts, generateImage, uploadAsset, getJobDownloadUrl, adminListJobs, adminUpdateJobStatus, adminEnableDownload, adminApproveJob, adminRejectJob } from '../controllers/videoJob.controller'
import { requireAuth } from '../middleware/auth'
import { requireAdmin, requirePermission } from '../middleware/adminAuth'

const router = Router()

// Customer routes
router.post('/', requireAuth, createJob)
router.post('/improve-script', requireAuth, improveScript)
router.post('/scene-prompts', requireAuth, suggestScenePrompts)
router.post('/generate-image', requireAuth, generateImage)
router.post('/upload-asset', requireAuth, uploadAsset)
router.get('/my/stats', requireAuth, getMyStats)
router.get('/my', requireAuth, getMyJobs)
router.get('/my/:referenceId', requireAuth, getJob)
router.post('/my/:referenceId/book-call', requireAuth, submitBookCall)
router.post('/my/:referenceId/cancel', requireAuth, cancelJob)
router.get('/my/:referenceId/download-url', requireAuth, getJobDownloadUrl)

// Admin routes
router.get('/admin', requireAdmin, adminListJobs)
router.patch('/admin/:id/status', requireAdmin, requirePermission('videos.manage'), adminUpdateJobStatus)
router.post('/admin/:id/approve', requireAdmin, requirePermission('videos.manage'), adminApproveJob)
router.post('/admin/:id/reject', requireAdmin, requirePermission('videos.manage'), adminRejectJob)
router.patch('/admin/:id/enable-download', requireAdmin, requirePermission('videos.manage'), adminEnableDownload)

export default router
