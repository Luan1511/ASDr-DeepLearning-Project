import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../lib/prisma'
import { requireAuth } from '../middleware/auth'
import { asyncHandler } from '../middleware/asyncHandler'
import { serializeResult, serializeScreening } from '../lib/serializers'

export const resultsRouter = Router()

resultsRouter.use(requireAuth)

resultsRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const userId = req.user!.id
    const id = z.string().uuid().parse(req.params.id)

    const result = await prisma.screeningResult.findUnique({
      where: { id },
      include: {
        video: {
          include: {
            child: true,
          },
        },
      },
    })

    if (!result || result.video.userId !== userId) {
      return res.status(404).json({ error: 'NOT_FOUND' })
    }

    const { video, ...row } = result
    return res.json({ result: { ...serializeResult(row), video: serializeScreening(video) } })
  }),
)
