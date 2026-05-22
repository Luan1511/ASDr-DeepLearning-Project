import { Router } from 'express'
import bcrypt from 'bcrypt'
import jwt from 'jsonwebtoken'
import { z } from 'zod'
import { prisma } from '../lib/prisma'
import { env } from '../lib/env'
import { asyncHandler } from '../middleware/asyncHandler'
import { requireAuth } from '../middleware/auth'

export const authRouter = Router()

const registerSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(6),
})

authRouter.post(
  '/register',
  asyncHandler(async (req, res) => {
    const input = registerSchema.parse(req.body)

    const existing = await prisma.user.findUnique({ where: { email: input.email } })
    if (existing) {
      return res.status(409).json({ error: 'EMAIL_EXISTS' })
    }

    const passwordHash = await bcrypt.hash(input.password, 10)
    const user = await prisma.user.create({
      data: {
        name: input.name,
        email: input.email,
        passwordHash,
      },
      select: { id: true, name: true, email: true, role: true, createdAt: true },
    })

    return res.status(201).json({ user })
  }),
)

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
})

authRouter.post(
  '/login',
  asyncHandler(async (req, res) => {
    const input = loginSchema.parse(req.body)

    const user = await prisma.user.findUnique({ where: { email: input.email } })
    if (!user) return res.status(401).json({ error: 'INVALID_CREDENTIALS' })

    const ok = await bcrypt.compare(input.password, user.passwordHash)
    if (!ok) return res.status(401).json({ error: 'INVALID_CREDENTIALS' })

    const token = jwt.sign(
      { email: user.email, name: user.name, role: user.role },
      env.JWT_SECRET,
      {
        subject: user.id,
        expiresIn: env.JWT_EXPIRES_IN,
      } as jwt.SignOptions,
    )

    return res.json({
      token,
      user: { id: user.id, name: user.name, email: user.email, role: user.role },
    })
  }),
)

authRouter.get(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    const userId = req.user!.id
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, name: true, email: true, role: true, createdAt: true },
    })
    return res.json({ user })
  }),
)

authRouter.post('/logout', (_req, res) => {
  // JWT is stateless; client deletes token.
  return res.json({ ok: true })
})
