import { Router } from 'express'
import { requireManager } from '../middleware/managerAuth'
import {
  activateManagerDashboardCelebrityProfile,
  createManagerDashboardCelebrity,
  getManagerDashboardAuditLogs,
  getManagerDashboardCelebrityProfile,
  getManagerDashboardOverview,
  getManagerDashboardRequests,
  getManagerDashboardTemplates,
  submitManagerDashboardCelebrityProfile,
  updateManagerDashboardCelebrityProfile,
  updateManagerDashboardTemplates,
} from '../controllers/managerDashboard.controller'

const router = Router()

router.get('/overview', requireManager, getManagerDashboardOverview)
router.get('/requests', requireManager, getManagerDashboardRequests)
router.post('/celebrities', requireManager, createManagerDashboardCelebrity)
router.get('/celebrities/:celebrityId/profile', requireManager, getManagerDashboardCelebrityProfile)
router.put('/celebrities/:celebrityId/profile', requireManager, updateManagerDashboardCelebrityProfile)
router.post('/celebrities/:celebrityId/profile/submit', requireManager, submitManagerDashboardCelebrityProfile)
router.post('/celebrities/:celebrityId/profile/activate', requireManager, activateManagerDashboardCelebrityProfile)
router.get('/templates', requireManager, getManagerDashboardTemplates)
router.patch('/templates/:celebrityId', requireManager, updateManagerDashboardTemplates)
router.get('/audit-logs', requireManager, getManagerDashboardAuditLogs)

export default router
