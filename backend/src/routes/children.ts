import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../lib/prisma'
import { requireAuth } from '../middleware/auth'
import { asyncHandler } from '../middleware/asyncHandler'
import { Gender } from '@prisma/client'

export const childrenRouter = Router()

childrenRouter.use(requireAuth)

childrenRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const userId = req.user!.id
    const children = await prisma.childProfile.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    })
    return res.json({ children })
  }),
)

const createChildSchema = z
  .object({
    fullName: z.string().min(1).optional(),
    full_name: z.string().min(1).optional(),
    dateOfBirth: z.string().min(1).optional(),
    date_of_birth: z.string().min(1).optional(),
    gender: z.string().optional(),
    note: z.string().optional(),
  })
  .refine((v) => v.fullName || v.full_name, { message: 'fullName is required' })
  .refine((v) => v.dateOfBirth || v.date_of_birth, { message: 'dateOfBirth is required' })

function parseGender(input?: string): Gender {
  const v = (input ?? '').trim().toUpperCase()
  if (v === 'MALE') return Gender.MALE
  if (v === 'FEMALE') return Gender.FEMALE
  if (v === 'OTHER') return Gender.OTHER
  return Gender.UNSPECIFIED
}

childrenRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const input = createChildSchema.parse(req.body)
    const userId = req.user!.id

    const fullName = input.fullName ?? input.full_name!
    const dobRaw = input.dateOfBirth ?? input.date_of_birth!
    const dateOfBirth = new Date(dobRaw)
    if (Number.isNaN(dateOfBirth.getTime())) {
      return res.status(400).json({ error: 'INVALID_DATE_OF_BIRTH' })
    }

    const child = await prisma.childProfile.create({
      data: {
        userId,
        fullName,
        dateOfBirth,
        gender: parseGender(input.gender),
        note: input.note,
      },
    })

    return res.status(201).json({ child })
  }),
)
