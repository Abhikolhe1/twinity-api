import { Router } from 'express'
import multer from 'multer'
import { adminLogin, getDashboardStats, listUsers, updateUserStatus, adminListCelebrities, adminForgotPassword, adminResetPassword } from '../controllers/admin.controller'
import { getMe } from '../controllers/team.controller'
import { requireAdmin, requirePermission } from '../middleware/adminAuth'
import { getSettings, updateSettings, getBlockedWords, addBlockedWord, removeBlockedWord, uploadWatermarkImage, deleteWatermarkImage } from '../controllers/settings.controller'

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
router.get('/dashboard', requireAdmin, getDashboardStats)
router.get('/users', requireAdmin, listUsers)
router.patch('/users/:id/status', requireAdmin, requirePermission('users.manage'), updateUserStatus)
router.get('/celebrities', requireAdmin, adminListCelebrities)
router.get('/settings', requireAdmin, getSettings)
router.put('/settings', requireAdmin, requirePermission('settings.manage'), updateSettings)
router.post('/settings/watermark-image', requireAdmin, requirePermission('settings.manage'), watermarkUpload, uploadWatermarkImage)
router.delete('/settings/watermark-image', requireAdmin, requirePermission('settings.manage'), deleteWatermarkImage)
// Blocked words — public GET for customer app, admin-only POST/DELETE
router.get('/settings/blocked-words', getBlockedWords)
router.post('/settings/blocked-words', requireAdmin, requirePermission('settings.manage'), addBlockedWord)
router.delete('/settings/blocked-words/:word', requireAdmin, requirePermission('settings.manage'), removeBlockedWord)

export default router
