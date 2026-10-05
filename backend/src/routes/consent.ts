import { Router } from 'express'
import { requireAuth } from '../middleware/auth'
import { asyncHandler } from '../middleware/asyncHandler'
import { getCurrentConsentStatement } from '../services/consentService'

export const consentRouter = Router()

consentRouter.use(requireAuth)

/** GET /api/consent/current — statement the guardian must accept before uploading. */
consentRouter.get(
  '/current',
  asyncHandler(async (_req, res) => {
    return res.json({ statement: await getCurrentConsentStatement() })
  }),
)
