import { Router } from 'express'
import { getCelebrityOnboardingMasters, submitCelebrityOnboarding } from '../controllers/celebrityOnboarding.controller'

const router = Router()

router.get('/masters', getCelebrityOnboardingMasters)
router.post('/', submitCelebrityOnboarding)

export default router
