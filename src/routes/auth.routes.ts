import { Router } from 'express'
import { register, login, verifyEmail, forgotPassword, resetPassword, getMe, updateProfile } from '../controllers/auth.controller'
import { requireAuth } from '../middleware/auth'

const router = Router()

router.post('/register', register)
router.post('/login', login)
router.get('/verify-email/:token', verifyEmail)
router.post('/forgot-password', forgotPassword)
router.post('/reset-password/:token', resetPassword)
router.get('/me', requireAuth, getMe)
router.put('/profile', requireAuth, updateProfile)

export default router
