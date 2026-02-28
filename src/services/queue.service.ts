/**
 * Queue Service — dispatches video jobs to the async processing pipeline.
 * In production: uses AWS SQS to enqueue jobs consumed by the AI Processing Pipeline (Python/FastAPI).
 * For local dev: logs the dispatch and simulates progression.
 */
import { logger } from '../config/logger'
import { VideoJob } from '../models/VideoJob'

export const queueService = {
  async dispatchVideoJob(jobId: string): Promise<void> {
    logger.info(`[Queue] Dispatching video job: ${jobId}`)

    // Production: send to SQS
    // const sqs = new AWS.SQS()
    // await sqs.sendMessage({ QueueUrl: env.sqsQueueUrl, MessageBody: JSON.stringify({ jobId, type: 'VIDEO_GENERATE' }) }).promise()

    // Dev: simulate status progression after delay
    if (process.env.NODE_ENV === 'development') {
      setTimeout(async () => {
        try {
          const job = await VideoJob.findById(jobId)
          if (job && job.status === 'pending') {
            job.status = 'in-progress'
            job.statusHistory.push({ status: 'in-progress', timestamp: new Date(), note: 'AI processing started' })
            await job.save()
            logger.info(`[Queue][Dev] Job ${jobId} → in-progress`)
          }
        } catch (err) {
          logger.error('[Queue] Dev simulation error:', err)
        }
      }, 5000)
    }
  },

  async dispatchNotification(type: string, payload: Record<string, unknown>): Promise<void> {
    logger.info(`[Queue] Notification dispatch: ${type}`, payload)
    // Production: SQS / SNS
  },
}
