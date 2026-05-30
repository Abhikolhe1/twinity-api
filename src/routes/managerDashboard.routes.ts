import { Router } from 'express'
import { requireManager } from '../middleware/managerAuth'
import {
  getManagerDashboardAuditLogs,
  getManagerDashboardOverview,
  getManagerDashboardRequests,
  getManagerDashboardTemplates,
  updateManagerDashboardTemplates,
} from '../controllers/managerDashboard.controller'

const router = Router()

router.get('/overview', requireManager, getManagerDashboardOverview)
router.get('/requests', requireManager, getManagerDashboardRequests)
router.get('/templates', requireManager, getManagerDashboardTemplates)
router.patch('/templates/:celebrityId', requireManager, updateManagerDashboardTemplates)
router.get('/audit-logs', requireManager, getManagerDashboardAuditLogs)

export default router
