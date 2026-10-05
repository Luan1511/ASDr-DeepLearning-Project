import 'dotenv/config'
import { createApp } from './app'
import { env } from './lib/env'
import { prisma } from './lib/prisma'
import { startScreeningWorker, stopScreeningWorker } from './services/screeningProcessor'

const app = createApp()

const server = app.listen(env.PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`ASDr backend listening on http://localhost:${env.PORT}`)
  startScreeningWorker()
})

let shuttingDown = false
function shutdown(signal: string) {
  if (shuttingDown) return
  shuttingDown = true
  // eslint-disable-next-line no-console
  console.log(`${signal} received, shutting down`)
  // Running jobs keep their lock; another worker re-queues them once the
  // heartbeat goes stale, so nothing is lost by exiting here.
  stopScreeningWorker()
  server.close(() => {
    prisma.$disconnect().finally(() => process.exit(0))
  })
  setTimeout(() => process.exit(0), 5000).unref()
}

process.on('SIGINT', () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))
