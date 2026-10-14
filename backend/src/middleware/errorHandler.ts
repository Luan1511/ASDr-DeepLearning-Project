import type { NextFunction, Request, Response } from 'express'
import { ZodError } from 'zod'
import { MulterError } from 'multer'
import { SCHEMA_OUTDATED_HINT, isSchemaOutdatedError } from '../lib/prismaErrors'
import { GENERIC_ERROR_MESSAGE, redactedErrorSummary } from '../lib/errorLog'
import { OpenPoseApiError } from '../services/openposeService'

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  // Prisma and JSON-parse errors can carry request data (answers, "Other"
  // descriptions, the raw body): only a one-line summary is logged for them.
  // eslint-disable-next-line no-console
  console.error('Request failed:', redactedErrorSummary(err) ?? err)

  // express.json() rejects a body that is not valid JSON: a client error, and
  // the body itself is never echoed.
  if ((err as { type?: unknown } | null)?.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'INVALID_JSON' })
  }

  if (err instanceof ZodError) {
    return res.status(400).json({
      error: 'VALIDATION_ERROR',
      details: err.flatten(),
    })
  }

  // Only admin routes let ML errors propagate here (parent routes map them to
  // friendly messages), so the technical message may be returned as is.
  if (err instanceof OpenPoseApiError) {
    const status = err.kind === 'http' && err.status && err.status < 500 ? err.status : 502
    return res.status(status).json({ error: 'ML_SERVER_ERROR', message: err.message, detail: err.detail })
  }

  if (isSchemaOutdatedError(err)) {
    return res.status(503).json({ error: 'DATABASE_MIGRATION_REQUIRED', message: SCHEMA_OUTDATED_HINT })
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
  }

  // Never echo an internal message (it may quote the request or the database).
  return res.status(500).json({ error: 'INTERNAL_SERVER_ERROR', message: GENERIC_ERROR_MESSAGE })
}
