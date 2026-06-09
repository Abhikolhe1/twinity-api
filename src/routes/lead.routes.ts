import { Router } from 'express'
import { submitContactForm, adminListLeads, adminGetLead, adminUpdateLeadStatus, adminLeadStats } from '../controllers/lead.controller'
import { requireAdmin, requirePermission } from '../middleware/adminAuth'

const router = Router()

// Public
router.post('/contact', submitContactForm)

// Admin
router.get('/admin', requireAdmin, adminListLeads)
router.get('/admin/stats', requireAdmin, adminLeadStats)
router.get('/admin/:id', requireAdmin, adminGetLead)
router.patch('/admin/:id/status', requireAdmin, requirePermission('leads.manage'), adminUpdateLeadStatus)

export default router
