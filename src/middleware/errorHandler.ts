import { Request, Response, NextFunction } from 'express'
import { logger } from '../config/logger'

export class AppError extends Error {
  statusCode: number
  constructor(message: string, statusCode = 400) {
    super(message)
    this.statusCode = statusCode
    Error.captureStackTrace(this, this.constructor)
  }
}

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof AppError) {
    res.status(err.statusCode).json({ success: false, message: err.message })
    return
  }

  if (err instanceof Error) {
    // Mongoose duplicate key
    if ((err as NodeJS.ErrnoException).name === 'MongoServerError' && (err as { code?: number }).code === 11000) {
      res.status(409).json({ success: false, message: 'A record with this value already exists' })
      return
    }
    // Mongoose validation error
    if (err.name === 'ValidationError') {
      res.status(422).json({ success: false, message: err.message })
      return
    }
    logger.error('Unhandled error:', err)
    res.status(500).json({ success: false, message: 'Internal server error' })
    return
  }

  res.status(500).json({ success: false, message: 'Internal server error' })
}
