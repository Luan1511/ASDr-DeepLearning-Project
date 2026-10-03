import express from 'express'
import cors from 'cors'
import path from 'path'
import { env } from './lib/env'
import { errorHandler } from './middleware/errorHandler'
import { apiRouter, pipelineRouter, subjectsRouter } from './routes'

export function createApp() {
  const app = express()
  // API polling represents changing job state. Disable ETags so a browser
  // never turns a successful polling response into HTTP 304 (Axios rejects it).
  app.disable('etag')

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

  // Direct OpenPose & Subject routes (without /api prefix) matching Python server directly
  app.use('/pipeline', pipelineRouter)
  app.use('/subjects', subjectsRouter)

  app.use('/api', (_req, res, next) => {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate')
    next()
  })
  app.use('/api', apiRouter)

  app.use(errorHandler)

  return app
}
