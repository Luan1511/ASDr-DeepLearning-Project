import type { NextFunction, Request, Response } from 'express'
import { ZodError } from 'zod'
import { MulterError } from 'multer'

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof ZodError) {
    return res.status(400).json({
      error: 'VALIDATION_ERROR',
      details: err.flatten(),
    })
  }

  if (err instanceof MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ error: 'FILE_TOO_LARGE' })
    }
    return res.status(400).json({ error: 'UPLOAD_ERROR', code: err.code })
  }

  if (err instanceof Error) {
    if (err.message === 'UNSUPPORTED_FILE_TYPE') {
      return res.status(400).json({ error: 'UNSUPPORTED_FILE_TYPE' })
    }
    const message = err.message || 'Unexpected error'
    return res.status(500).json({ error: 'INTERNAL_SERVER_ERROR', message })
  }

  return res.status(500).json({ error: 'INTERNAL_SERVER_ERROR', message: 'Unexpected error' })
}
