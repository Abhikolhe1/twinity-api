import { Router } from 'express'
import { adminLogin, getDashboardStats, listUsers, updateUserStatus, adminListCelebrities, adminForgotPassword, adminResetPassword } from '../controllers/admin.controller'
import { getMe } from '../controllers/team.controller'
import { requireAdmin, requireRole } from '../middleware/adminAuth'

const router = Router()

router.post('/login', adminLogin)
router.post('/forgot-password', adminForgotPassword)
router.post('/reset-password/:token', adminResetPassword)
router.get('/me', requireAdmin, getMe)
router.get('/dashboard', requireAdmin, getDashboardStats)
router.get('/users', requireAdmin, listUsers)
router.patch('/users/:id/status', requireAdmin, requireRole('super-admin', 'admin'), updateUserStatus)
router.get('/celebrities', requireAdmin, adminListCelebrities)

export default router
