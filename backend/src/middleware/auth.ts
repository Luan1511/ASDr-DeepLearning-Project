import type { NextFunction, Request, Response } from 'express'
import jwt from 'jsonwebtoken'
import { env } from '../lib/env'

type JwtPayload = {
  sub: string
  email: string
  name: string
  role: string
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization
  if (!header?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'UNAUTHORIZED' })
  }

  const token = header.slice('Bearer '.length)
  try {
    const decoded = jwt.verify(token, env.JWT_SECRET) as JwtPayload
    req.user = {
      id: decoded.sub,
      email: decoded.email,
      name: decoded.name,
      role: decoded.role as any,
    }
    return next()
  } catch {
    return res.status(401).json({ error: 'UNAUTHORIZED' })
  }
}
