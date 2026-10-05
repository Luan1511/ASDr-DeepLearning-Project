import type { NextFunction, Request, Response } from 'express'

/** Same rule as the ML server: subject ids become directory names there. */
export const SUBJECT_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/

/** Router.param handler for `:subject_id`. */
export function validateSubjectIdParam(_req: Request, res: Response, next: NextFunction, value: string) {
  if (!SUBJECT_ID_PATTERN.test(value)) {
    return res.status(422).json({ error: 'INVALID_SUBJECT_ID' })
  }
  return next()
}
