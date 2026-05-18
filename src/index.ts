import { env } from './config/env'
import { connectDatabase } from './config/database'
import { logger } from './config/logger'
import app from './app'
import { queueService } from './services/queue.service'

async function start() {
  await connectDatabase()
  app.listen(env.port, () => {
    logger.info(`twinity-api running on port ${env.port} [${env.nodeEnv}]`)
    logger.info(`  Auth:        /api/auth`)
    logger.info(`  Celebrities: /api/celebrities`)
    logger.info(`  Jobs:        /api/jobs`)
    logger.info(`  Leads:       /api/leads`)
    logger.info(`  Admin:       /api/admin`)
    logger.info(`  Templates:   /api/templates`)
  })
}

start()

export default app
