import { Router } from 'express'
import { submitCelebrityOnboarding } from '../controllers/celebrityOnboarding.controller'

const router = Router()

router.post('/', submitCelebrityOnboarding)

export default router
