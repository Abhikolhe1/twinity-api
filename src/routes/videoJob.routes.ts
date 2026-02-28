import { Router } from 'express'
import { createJob, getMyJobs, getJob, submitBookCall, adminListJobs, adminUpdateJobStatus, adminEnableDownload } from '../controllers/videoJob.controller'
import { requireAuth } from '../middleware/auth'
import { requireAdmin, requireRole } from '../middleware/adminAuth'

const router = Router()

// Customer routes
router.post('/', requireAuth, createJob)
router.get('/my', requireAuth, getMyJobs)
router.get('/my/:referenceId', requireAuth, getJob)
router.post('/my/:referenceId/book-call', requireAuth, submitBookCall)

// Admin routes
router.get('/admin', requireAdmin, adminListJobs)
router.patch('/admin/:id/status', requireAdmin, requireRole('super-admin', 'admin'), adminUpdateJobStatus)
router.patch('/admin/:id/enable-download', requireAdmin, requireRole('super-admin', 'admin'), adminEnableDownload)

export default router
