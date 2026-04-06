import { Router } from 'express'
import { adminLogin, getDashboardStats, listUsers, updateUserStatus, adminListCelebrities, adminForgotPassword, adminResetPassword } from '../controllers/admin.controller'
import { getMe } from '../controllers/team.controller'
import { requireAdmin, requirePermission } from '../middleware/adminAuth'
import { getSettings, updateSettings, getBlockedWords, addBlockedWord, removeBlockedWord } from '../controllers/settings.controller'

const router = Router()

router.post('/login', adminLogin)
router.post('/forgot-password', adminForgotPassword)
router.post('/reset-password/:token', adminResetPassword)
router.get('/me', requireAdmin, getMe)
router.get('/dashboard', requireAdmin, getDashboardStats)
router.get('/users', requireAdmin, listUsers)
router.patch('/users/:id/status', requireAdmin, requirePermission('users.manage'), updateUserStatus)
router.get('/celebrities', requireAdmin, adminListCelebrities)
router.get('/settings', requireAdmin, getSettings)
router.put('/settings', requireAdmin, requirePermission('settings.manage'), updateSettings)
// Blocked words — public GET for customer app, admin-only POST/DELETE
router.get('/settings/blocked-words', getBlockedWords)
router.post('/settings/blocked-words', requireAdmin, requirePermission('settings.manage'), addBlockedWord)
router.delete('/settings/blocked-words/:word', requireAdmin, requirePermission('settings.manage'), removeBlockedWord)

export default router
