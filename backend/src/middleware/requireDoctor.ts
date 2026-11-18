import type { NextFunction, Request, Response } from 'express'
import { env } from '../lib/env'
import { prisma } from '../lib/prisma'
import { asyncHandler } from './asyncHandler'

/** DOCTOR_MODE gate: off → the doctor feature does not exist for anyone. */
export function requireDoctorsEnabled(_req: Request, res: Response, next: NextFunction) {
  if (env.DOCTOR_MODE === 'off') return res.status(403).json({ error: 'DOCTORS_DISABLED' })
  return next()
}

/**
 * The signed-in account must be a doctor (it owns a DoctorProfile). Sample
 * doctors only work in demo mode: once the feature is opened to real doctors
 * (DOCTOR_MODE=on) the sample accounts can no longer read anything.
 */
export const requireDoctor = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  const doctor = await prisma.doctorProfile.findUnique({ where: { userId: req.user!.id } })
  if (!doctor) return res.status(403).json({ error: 'DOCTOR_ONLY' })
  if (doctor.isMock && env.DOCTOR_MODE !== 'demo') return res.status(403).json({ error: 'DOCTORS_DISABLED' })
  req.doctor = doctor
  return next()
})
