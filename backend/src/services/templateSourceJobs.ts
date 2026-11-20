import { randomUUID } from 'crypto'
import { GENERIC_ERROR_MESSAGE, redactedErrorSummary } from '../lib/errorLog'
import { OpenPoseApiError } from './openposeError'

/** HTTP-shaped outcome of one extraction, as the synchronous route used to send it. */
export type JobReply = { status: number; body: Record<string, unknown> }

export type TemplateSourceJobView =
  | { jobId: string; status: 'running' }
  | { jobId: string; status: 'done'; source: Record<string, unknown> }
  | { jobId: string; status: 'failed'; httpStatus: number; error: string; message?: string }

type Job = {
  id: string
  exerciseId: string
  startedAt: number
  finishedAt: number | null
  reply: JobReply | null
}

/** Finished jobs stay readable this long, so a slow poll still gets its answer. */
const FINISHED_TTL_MS = 60 * 60 * 1000

/** Same mapping as the global error handler for errors thrown during extraction. */
export function replyForError(err: unknown): JobReply {
  if (err instanceof OpenPoseApiError) {
    const status = err.kind === 'http' && err.status && err.status < 500 ? err.status : 502
    return { status, body: { error: 'ML_SERVER_ERROR', message: err.message, detail: err.detail } }
  }
  return { status: 500, body: { error: 'INTERNAL_SERVER_ERROR', message: GENERIC_ERROR_MESSAGE } }
}

/**
 * Template-source extractions run in the background: OpenPose plus the face
 * blur often take longer than the 100 s a Cloudflare tunnel waits for a
 * response. Jobs live in this process only (one backend replica); a restart
 * loses them and the admin uploads again. At most one job runs per exercise.
 */
export class TemplateSourceJobs {
  private readonly jobs = new Map<string, Job>()

  constructor(private readonly now: () => number = Date.now) {}

  /** The running job of an exercise, if any. */
  running(exerciseId: string): TemplateSourceJobView | null {
    this.prune()
    for (const job of this.jobs.values()) {
      if (job.exerciseId === exerciseId && !job.reply) return this.view(job)
    }
    return null
  }

  start(exerciseId: string, work: () => Promise<JobReply>): TemplateSourceJobView {
    this.prune()
    const job: Job = { id: randomUUID(), exerciseId, startedAt: this.now(), finishedAt: null, reply: null }
    this.jobs.set(job.id, job)
    void (async () => {
      let reply: JobReply
      try {
        reply = await work()
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('Template source extraction failed:', redactedErrorSummary(err) ?? err)
        reply = replyForError(err)
      }
      job.reply = reply
      job.finishedAt = this.now()
    })()
    return this.view(job)
  }

  get(exerciseId: string, jobId: string): TemplateSourceJobView | null {
    this.prune()
    const job = this.jobs.get(jobId)
    return job && job.exerciseId === exerciseId ? this.view(job) : null
  }

  private view(job: Job): TemplateSourceJobView {
    const { reply } = job
    if (!reply) return { jobId: job.id, status: 'running' }
    if (reply.status < 300) return { jobId: job.id, status: 'done', source: reply.body }
    const { error, message } = reply.body as { error?: unknown; message?: unknown }
    return {
      jobId: job.id,
      status: 'failed',
      httpStatus: reply.status,
      error: typeof error === 'string' ? error : 'INTERNAL_SERVER_ERROR',
      ...(typeof message === 'string' ? { message } : {}),
    }
  }

  private prune() {
    const cutoff = this.now() - FINISHED_TTL_MS
    for (const [id, job] of this.jobs) {
      if (job.finishedAt !== null && job.finishedAt < cutoff) this.jobs.delete(id)
    }
  }
}

export const templateSourceJobs = new TemplateSourceJobs()
