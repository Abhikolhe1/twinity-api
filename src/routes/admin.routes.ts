import { Router } from 'express'
import multer from 'multer'
import {
  adminListCelebrities,
  getDashboardStats,
  getUserAuditLogs,
  getUserDetail,
  listAuditLogs,
  listUsers,
  portalForgotPassword,
  portalLogin,
  portalResetPassword,
  updateUserStatus,
} from '../controllers/admin.controller'
import {
  activateCelebrityProfile,
  approveCelebrityApplication,
  createCelebrityPortalAccess,
  getCelebrityProfileByAdmin,
  getMyCelebrityProfile,
  listCelebrityApplications,
  rejectCelebrityApplication,
  requestCelebrityProfileChanges,
  submitMyCelebrityProfileForReview,
  updateCelebrityProfileByAdmin,
  updateMyCelebrityProfile,
} from '../controllers/celebrityOnboarding.controller'
import {
  addBlockedWord,
  deleteWatermarkImage,
  getBlockedWords,
  getSettings,
  removeBlockedWord,
  updateSettings,
  uploadWatermarkImage,
} from '../controllers/settings.controller'
import { getMe } from '../controllers/team.controller'
import { requireAdmin, requirePermission, requireRole } from '../middleware/adminAuth'

const router = Router()

const watermarkUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true)
    else cb(new Error('Only image files are allowed'))
  },
}).single('image')

router.post('/login', portalLogin)
router.post('/forgot-password', portalForgotPassword)
router.post('/reset-password/:token', portalResetPassword)
router.get('/me', requireAdmin, getMe)
router.get('/dashboard', requireAdmin, requirePermission('dashboard.view'), getDashboardStats)
router.get('/users', requireAdmin, requirePermission('users.view'), listUsers)
router.get('/users/:id', requireAdmin, requirePermission('users.view'), getUserDetail)
router.patch('/users/:id/status', requireAdmin, requirePermission('users.manage'), updateUserStatus)
router.get('/users/:id/audit-logs', requireAdmin, requirePermission('audit_logs.view'), getUserAuditLogs)
router.get('/audit-logs', requireAdmin, requirePermission('audit_logs.view'), listAuditLogs)
router.get('/celebrities', requireAdmin, requirePermission('celebrities.view'), adminListCelebrities)
router.post('/celebrities/:id/portal-access', requireAdmin, requireRole('super-admin'), requirePermission('celebrities.manage'), createCelebrityPortalAccess)
router.get('/celebrities/:id/profile', requireAdmin, requirePermission('celebrities.view'), getCelebrityProfileByAdmin)
router.put('/celebrities/:id/profile', requireAdmin, requirePermission('celebrities.manage'), updateCelebrityProfileByAdmin)
router.post('/celebrities/:id/profile/request-changes', requireAdmin, requireRole('super-admin'), requirePermission('celebrities.manage'), requestCelebrityProfileChanges)
router.post('/celebrities/:id/profile/activate', requireAdmin, requireRole('super-admin'), requirePermission('celebrities.manage'), activateCelebrityProfile)
router.get('/celebrity-applications', requireAdmin, requirePermission('celebrity_applications.view'), listCelebrityApplications)
router.post('/celebrity-applications/:id/approve', requireAdmin, requireRole('super-admin'), requirePermission('celebrity_applications.manage'), approveCelebrityApplication)
router.post('/celebrity-applications/:id/reject', requireAdmin, requireRole('super-admin'), requirePermission('celebrity_applications.manage'), rejectCelebrityApplication)
router.get('/celebrity/profile', requireAdmin, requirePermission('celebrity.profile.view'), getMyCelebrityProfile)
router.put('/celebrity/profile', requireAdmin, requirePermission('celebrity.profile.update'), updateMyCelebrityProfile)
router.post('/celebrity/profile/submit', requireAdmin, requirePermission('celebrity.profile.update'), submitMyCelebrityProfileForReview)
router.get('/settings', requireAdmin, requirePermission('settings.view'), getSettings)
router.put('/settings', requireAdmin, requirePermission('settings.manage'), updateSettings)
router.post('/settings/watermark-image', requireAdmin, requirePermission('settings.manage'), watermarkUpload, uploadWatermarkImage)
router.delete('/settings/watermark-image', requireAdmin, requirePermission('settings.manage'), deleteWatermarkImage)
router.get('/settings/blocked-words', getBlockedWords)
router.post('/settings/blocked-words', requireAdmin, requirePermission('settings.manage'), addBlockedWord)
router.delete('/settings/blocked-words/:word', requireAdmin, requirePermission('settings.manage'), removeBlockedWord)

export default router
