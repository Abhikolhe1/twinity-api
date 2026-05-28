import prisma from '../lib/prisma'
import { logger } from './logger'

export async function connectDatabase(): Promise<void> {
  try {
    await prisma.$connect()
    logger.info('PostgreSQL connected successfully via Prisma')
  } catch (err) {
    logger.error('PostgreSQL connection failed:', err)
    process.exit(1)
  }
}

process.on('beforeExit', async () => {
  await prisma.$disconnect()
})
