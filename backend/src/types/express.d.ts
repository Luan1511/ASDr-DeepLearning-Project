import type { DoctorProfile, UserRole } from '@prisma/client'

declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string
        email: string
        name: string
        role: UserRole
      }
      /** Set by requireDoctor: the doctor profile of the signed-in account. */
      doctor?: DoctorProfile
    }
  }
}

export {}
