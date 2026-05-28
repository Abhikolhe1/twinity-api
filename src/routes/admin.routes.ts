import { Router } from 'express'
import multer from 'multer'
import { adminLogin, getDashboardStats, listUsers, updateUserStatus, getUserDetail, listAuditLogs, getUserAuditLogs, adminListCelebrities, adminForgotPassword, adminResetPassword } from '../controllers/admin.controller'
import { getMe } from '../controllers/team.controller'
import { requireAdmin, requirePermission, requireRole } from '../middleware/adminAuth'
import { getSettings, updateSettings, getBlockedWords, addBlockedWord, removeBlockedWord, uploadWatermarkImage, deleteWatermarkImage } from '../controllers/settings.controller'
import {
  approveCelebrityApplication,
  createCelebrityPortalAccess,
  getMyCelebrityProfile,
  listCelebrityApplications,
  rejectCelebrityApplication,
  updateMyCelebrityProfile,
} from '../controllers/celebrityOnboarding.controller'

const router = Router()

const watermarkUpload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true)
    else cb(new Error('Only image files are allowed'))
  },
}).single('image')

router.post('/login', adminLogin)
router.post('/forgot-password', adminForgotPassword)
router.post('/reset-password/:token', adminResetPassword)
router.get('/me', requireAdmin, getMe)
router.get('/dashboard', requireAdmin, requirePermission('dashboard.view'), getDashboardStats)
router.get('/users', requireAdmin, requirePermission('users.view'), listUsers)
router.get('/users/:id', requireAdmin, requirePermission('users.view'), getUserDetail)
router.patch('/users/:id/status', requireAdmin, requirePermission('users.manage'), updateUserStatus)
router.get('/users/:id/audit-logs', requireAdmin, requirePermission('audit_logs.view'), getUserAuditLogs)
router.get('/audit-logs', requireAdmin, requirePermission('audit_logs.view'), listAuditLogs)
router.get('/celebrities', requireAdmin, requirePermission('celebrities.view'), adminListCelebrities)
router.post('/celebrities/:id/portal-access', requireAdmin, requireRole('super-admin'), requirePermission('celebrities.manage'), createCelebrityPortalAccess)
router.get('/celebrity-applications', requireAdmin, requirePermission('celebrity_applications.view'), listCelebrityApplications)
router.post('/celebrity-applications/:id/approve', requireAdmin, requireRole('super-admin'), requirePermission('celebrity_applications.manage'), approveCelebrityApplication)
router.post('/celebrity-applications/:id/reject', requireAdmin, requireRole('super-admin'), requirePermission('celebrity_applications.manage'), rejectCelebrityApplication)
router.get('/celebrity/profile', requireAdmin, requirePermission('celebrity.profile.view'), getMyCelebrityProfile)
router.put('/celebrity/profile', requireAdmin, requirePermission('celebrity.profile.update'), updateMyCelebrityProfile)
router.get('/settings', requireAdmin, requirePermission('settings.view'), getSettings)
router.put('/settings', requireAdmin, requirePermission('settings.manage'), updateSettings)
router.post('/settings/watermark-image', requireAdmin, requirePermission('settings.manage'), watermarkUpload, uploadWatermarkImage)
router.delete('/settings/watermark-image', requireAdmin, requirePermission('settings.manage'), deleteWatermarkImage)
// Blocked words — public GET for customer app, admin-only POST/DELETE
router.get('/settings/blocked-words', getBlockedWords)
router.post('/settings/blocked-words', requireAdmin, requirePermission('settings.manage'), addBlockedWord)
router.delete('/settings/blocked-words/:word', requireAdmin, requirePermission('settings.manage'), removeBlockedWord)

export default router
