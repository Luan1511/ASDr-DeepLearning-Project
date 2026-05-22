import type { NextFunction, Request, Response } from 'express'
import type { UserRole } from '@prisma/client'

export function requireRole(role: UserRole) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) return res.status(401).json({ error: 'UNAUTHORIZED' })
    if (req.user.role !== role) return res.status(403).json({ error: 'FORBIDDEN' })
    return next()
  }
}
