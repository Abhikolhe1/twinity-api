import { Router } from 'express'
import {
  getManagerMe,
  managerForgotPassword,
  managerLogin,
  managerResetPassword,
} from '../controllers/manager.controller'
import { requireManager } from '../middleware/managerAuth'

const router = Router()

router.post('/login', managerLogin)
router.post('/forgot-password', managerForgotPassword)
router.post('/reset-password/:token', managerResetPassword)
router.get('/me', requireManager, getManagerMe)

export default router
