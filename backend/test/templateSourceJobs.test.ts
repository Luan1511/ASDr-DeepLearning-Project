import { test } from 'node:test'
import assert from 'node:assert/strict'
import { TemplateSourceJobs, replyForError } from '../src/services/templateSourceJobs'
import { OpenPoseApiError } from '../src/services/openposeError'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

const flush = () => new Promise((resolve) => setImmediate(resolve))

test('a job is running until its work settles, then done with the source', async () => {
  const jobs = new TemplateSourceJobs()
  const work = deferred<{ status: number; body: Record<string, unknown> }>()
  const started = jobs.start('ex-1', () => work.promise)
  assert.equal(started.status, 'running')
  assert.deepEqual(jobs.running('ex-1'), started)
  assert.equal(jobs.running('ex-2'), null)

  work.resolve({ status: 201, body: { sourceSubjectId: 'tpl_x', numFrames: 10 } })
  await flush()
  assert.deepEqual(jobs.get('ex-1', started.jobId), {
    jobId: started.jobId,
    status: 'done',
    source: { sourceSubjectId: 'tpl_x', numFrames: 10 },
  })
  assert.equal(jobs.running('ex-1'), null)
})

test('a job is only visible under its own exercise', () => {
  const jobs = new TemplateSourceJobs()
  const started = jobs.start('ex-1', () => new Promise(() => {}))
  assert.equal(jobs.get('ex-2', started.jobId), null)
  assert.equal(jobs.get('ex-1', 'missing'), null)
})

test('an error reply or a thrown error becomes a failed job with its code', async () => {
  const jobs = new TemplateSourceJobs()
  const refused = jobs.start('ex-1', async () => ({ status: 415, body: { error: 'RECORDING_FORMAT_UNSUPPORTED' } }))
  const thrown = jobs.start('ex-2', async () => {
    throw new OpenPoseApiError('ML down', 'network')
  })
  await flush()
  assert.deepEqual(jobs.get('ex-1', refused.jobId), {
    jobId: refused.jobId, status: 'failed', httpStatus: 415, error: 'RECORDING_FORMAT_UNSUPPORTED',
  })
  assert.deepEqual(jobs.get('ex-2', thrown.jobId), {
    jobId: thrown.jobId, status: 'failed', httpStatus: 502, error: 'ML_SERVER_ERROR', message: 'ML down',
  })
})

test('finished jobs are forgotten after an hour; running ones are kept', async () => {
  let now = 0
  const jobs = new TemplateSourceJobs(() => now)
  const done = jobs.start('ex-1', async () => ({ status: 201, body: {} }))
  const running = jobs.start('ex-2', () => new Promise(() => {}))
  await flush()
  now = 60 * 60 * 1000 + 1
  assert.equal(jobs.get('ex-1', done.jobId), null)
  assert.equal(jobs.get('ex-2', running.jobId)?.status, 'running')
})

test('replyForError keeps ML 4xx statuses and hides other errors', () => {
  assert.equal(replyForError(new OpenPoseApiError('bad', 'http', 422)).status, 422)
  assert.equal(replyForError(new OpenPoseApiError('boom', 'http', 500)).status, 502)
  const internal = replyForError(new Error('secret detail'))
  assert.equal(internal.status, 500)
  assert.equal(internal.body.error, 'INTERNAL_SERVER_ERROR')
  assert.ok(!JSON.stringify(internal.body).includes('secret'))
})
