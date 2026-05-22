import express from 'express'
import cors from 'cors'
import path from 'path'
import { env } from './lib/env'
import { errorHandler } from './middleware/errorHandler'
import { apiRouter } from './routes'

export function createApp() {
  const app = express()

  app.use(
    cors({
      origin: env.CORS_ORIGIN.split(',').map((s) => s.trim()),
      credentials: true,
    }),
  )

  app.use(express.json({ limit: '2mb' }))

  // Static uploads (local storage)
  app.use('/uploads', express.static(path.join(process.cwd(), 'uploads')))

  app.get('/api/health', (_req, res) => res.json({ ok: true }))

  app.use('/api', apiRouter)

  app.use(errorHandler)

  return app
}
