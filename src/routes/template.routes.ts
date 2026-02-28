import { Router } from 'express'
import { listTemplates } from '../controllers/template.controller'

const router = Router()

router.get('/', listTemplates)

export default router
