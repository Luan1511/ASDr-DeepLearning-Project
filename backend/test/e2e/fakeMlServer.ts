/**
 * Node fake of the OpenPose/ST-GCN ML server for the e2e tests (spec §7.2).
 *
 * The "videos" the backend uploads are tiny JSON documents naming what the
 * fake should pretend to have seen:
 *   { "slug": "dang-tay", "scenario": "identical", "seed": 1 }  child attempt (test/syntheticImitation.ts)
 *   { "template": "dang-tay" }                                   adult built-in demonstration (template source)
 *   { "screening": true }                                        any walking clip for /pipeline/asd
 * No real video, no real child data.
 *
 * Modes: `v2` (GET /health with video_retention, accepts .webm, reports fps)
 * and `legacy` (ML 1.0: /health → 404, rejects .webm, no fps).
 * Switches: N×5xx on extract, permanent 422 "no person", HTML 404 for every
 * route (offline ngrok) or only for DELETE, ignore ?subject_id, a hold gate
 * and a delay for heavy calls. Counters: extract calls (with the file name
 * the backend sent), /pipeline/asd calls, concurrent heavy calls.
 */
import http from 'node:http'
import { randomUUID } from 'node:crypto'
import type { OpenPoseKeypointFrame } from '../../src/services/openposeService'
import { BUILTIN_EXERCISES, BUILTIN_VIDEO_SIZE } from '../../src/services/imitation'
import { buildScenario, SCENARIO_NAMES, type ScenarioName } from '../syntheticImitation'

export type FakeMlMode = 'v2' | 'legacy'

export interface FakeMlSwitches {
  mode: FakeMlMode
  /** Every route answers an HTML 404 page (ngrok tunnel without a running server). */
  offline: boolean
  /** Only DELETE /subjects/:id answers the HTML 404 page. */
  offlineDeletes: boolean
  /** The next N extract calls answer 503. */
  failExtractTimes: number
  /** Every extract answers 422 "no person detected". */
  extract422: boolean
  /** Store the subject under a generated id (ML 1.0 behaviour). */
  ignoreSubjectId: boolean
  /** Extra latency of every heavy call (extract, pipeline, predict). */
  heavyDelayMs: number
}

export interface ExtractCall {
  requestedId: string | null
  storedAs: string | null
  filename: string
  mimeType: string
  status: number
}

interface StoredSubject {
  id: string
  filename: string
  createdAt: string
  frames: OpenPoseKeypointFrame[]
  fps: number
  width: number
  height: number
  prediction: Record<string, unknown> | null
}

const DEFAULT_SWITCHES: FakeMlSwitches = {
  mode: 'v2',
  offline: false,
  offlineDeletes: false,
  failExtractTimes: 0,
  extract422: false,
  ignoreSubjectId: false,
  heavyDelayMs: 0,
}

const NGROK_HTML =
  '<!DOCTYPE html><html><head><title>ERR_NGROK_3200</title></head><body>The endpoint is offline.</body></html>'

const SUBJECT_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/

export class FakeMlServer {
  readonly switches: FakeMlSwitches = { ...DEFAULT_SWITCHES }
  readonly subjects = new Map<string, StoredSubject>()
  extractCalls: ExtractCall[] = []
  pipelineCalls = 0
  deleteCalls: string[] = []
  heavyActive = 0
  heavyMaxConcurrent = 0
  heavyLog: Array<{ kind: string; start: number; end: number }> = []

  private server: http.Server | null = null
  private holdPromise: Promise<void> | null = null
  private releaseHold: (() => void) | null = null
  private holdWaiters = 0

  constructor(readonly port: number) {}

  async start(): Promise<void> {
    this.server = http.createServer((req, res) => {
      this.handle(req, res).catch((error) => {
        if (!res.headersSent) sendJson(res, 500, { detail: `fake ML crashed: ${(error as Error).message}` })
      })
    })
    await new Promise<void>((resolve, reject) => {
      this.server!.once('error', reject)
      this.server!.listen(this.port, '127.0.0.1', () => resolve())
    })
  }

  async stop(): Promise<void> {
    this.release()
    const server = this.server
    this.server = null
    if (!server) return
    server.closeAllConnections?.()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }

  /** Back to a healthy v2 server; stored subjects are kept unless `clearSubjects`. */
  reset(options: { clearSubjects?: boolean } = {}) {
    Object.assign(this.switches, DEFAULT_SWITCHES)
    this.release()
    this.resetCounters()
    if (options.clearSubjects) this.subjects.clear()
  }

  resetCounters() {
    this.extractCalls = []
    this.pipelineCalls = 0
    this.deleteCalls = []
    this.heavyMaxConcurrent = this.heavyActive
    this.heavyLog = []
  }

  /** Heavy calls wait until release() (simulates a long OpenPose run). */
  hold() {
    if (this.holdPromise) return
    this.holdPromise = new Promise<void>((resolve) => {
      this.releaseHold = resolve
    })
  }

  release() {
    this.releaseHold?.()
    this.holdPromise = null
    this.releaseHold = null
  }

  /** Number of heavy calls currently blocked by hold(). */
  get heldCalls(): number {
    return this.holdWaiters
  }

  subjectIds(prefix?: string): string[] {
    return [...this.subjects.keys()].filter((id) => !prefix || id.startsWith(prefix))
  }

  extractCallsFor(subjectId: string): ExtractCall[] {
    return this.extractCalls.filter((c) => c.requestedId === subjectId || c.storedAs === subjectId)
  }

  // -------------------------------------------------------------------------

  private async handle(req: http.IncomingMessage, res: http.ServerResponse) {
    const url = new URL(req.url ?? '/', `http://127.0.0.1:${this.port}`)
    const method = req.method ?? 'GET'
    const body = await readBody(req)

    if (this.switches.offline || (this.switches.offlineDeletes && method === 'DELETE')) {
      res.writeHead(404, { 'Content-Type': 'text/html' })
      res.end(NGROK_HTML)
      return
    }

    const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent)

    if (method === 'GET' && url.pathname === '/') {
      return sendJson(res, 200, { message: 'fake OpenPose server', routes: ['/subjects', '/pipeline/asd'] })
    }
    if (method === 'GET' && url.pathname === '/health') {
      if (this.switches.mode === 'legacy') return sendJson(res, 404, { detail: 'Not Found' })
      return sendJson(res, 200, {
        status: 'ok',
        version: '2.0.0-fake',
        model_loaded: true,
        calibrated: false,
        video_retention: 'none',
        auth_required: false,
      })
    }
    if (method === 'POST' && url.pathname === '/subjects/extract') {
      return this.heavy('extract', () => this.extract(req, res, url, body))
    }
    if (method === 'POST' && url.pathname === '/pipeline/asd') {
      return this.heavy('pipeline', () => this.pipeline(req, res, url, body))
    }
    if (method === 'GET' && url.pathname === '/subjects') {
      return sendJson(res, 200, {
        total: this.subjects.size,
        subjects: [...this.subjects.values()].map((s) => this.metadata(s)),
      })
    }
    if (parts[0] === 'subjects' && parts.length >= 2) {
      const subject = this.subjects.get(parts[1])
      const tail = parts.slice(2).join('/')
      if (method === 'DELETE' && tail === '') {
        this.deleteCalls.push(parts[1])
        if (!subject) return sendJson(res, 404, { detail: 'Subject not found' })
        this.subjects.delete(parts[1])
        return sendJson(res, 200, { subject_id: parts[1], deleted: true })
      }
      if (method === 'POST' && tail === 'predict') {
        return this.heavy('predict', async () => {
          if (!subject) return sendJson(res, 404, { detail: 'Subject not found' })
          subject.prediction = fakePrediction(subject.id)
          return sendJson(res, 200, { subject_id: subject.id, created_at: subject.createdAt, prediction: subject.prediction })
        })
      }
      if (method === 'GET') {
        if (!subject) return sendJson(res, 404, { detail: 'Subject not found' })
        if (tail === '') {
          return sendJson(res, 200, {
            metadata: this.metadata(subject),
            ...(subject.prediction
              ? { prediction: { subject_id: subject.id, created_at: subject.createdAt, prediction: subject.prediction } }
              : {}),
          })
        }
        if (tail === 'keypoints') {
          return sendJson(res, 200, {
            subject_id: subject.id,
            keypoint_format: 'BODY_25',
            num_frames: subject.frames.length,
            ...(this.switches.mode === 'v2' ? { video: this.videoInfo(subject) } : {}),
            frames: subject.frames,
          })
        }
        if (tail === 'prediction') {
          if (!subject.prediction) return sendJson(res, 404, { detail: 'No prediction for this subject' })
          return sendJson(res, 200, { subject_id: subject.id, created_at: subject.createdAt, prediction: subject.prediction })
        }
      }
    }
    return sendJson(res, 404, { detail: 'Not Found' })
  }

  private async heavy(kind: string, run: () => Promise<void> | void) {
    this.heavyActive += 1
    this.heavyMaxConcurrent = Math.max(this.heavyMaxConcurrent, this.heavyActive)
    const start = Date.now()
    try {
      if (this.holdPromise) {
        this.holdWaiters += 1
        try {
          await this.holdPromise
        } finally {
          this.holdWaiters -= 1
        }
      }
      if (this.switches.heavyDelayMs > 0) await sleep(this.switches.heavyDelayMs)
      await run()
    } finally {
      this.heavyActive -= 1
      this.heavyLog.push({ kind, start, end: Date.now() })
    }
  }

  private async extract(req: http.IncomingMessage, res: http.ServerResponse, url: URL, body: Buffer) {
    const file = parseMultipartFile(req.headers['content-type'] ?? '', body)
    const requestedId = url.searchParams.get('subject_id')
    const call: ExtractCall = {
      requestedId,
      storedAs: null,
      filename: file?.filename ?? '',
      mimeType: file?.contentType ?? '',
      status: 0,
    }
    this.extractCalls.push(call)
    const reply = (status: number, payload: unknown) => {
      call.status = status
      sendJson(res, status, payload)
    }

    if (!file) return reply(400, { detail: 'No video uploaded' })
    if (this.switches.failExtractTimes > 0) {
      this.switches.failExtractTimes -= 1
      return reply(503, { detail: 'GPU busy (fake 5xx)' })
    }
    const ext = file.filename.toLowerCase().slice(file.filename.lastIndexOf('.'))
    const allowed = this.switches.mode === 'v2' ? ['.mp4', '.mov', '.avi', '.mkv', '.webm'] : ['.mp4', '.mov', '.avi', '.mkv']
    if (!allowed.includes(ext)) return reply(400, { detail: `Unsupported video format: ${ext}` })
    if (this.switches.extract422) return reply(422, { detail: 'OpenPose found no person in the video' })

    let subjectId = requestedId && !this.switches.ignoreSubjectId ? requestedId : `auto_${randomUUID().replace(/-/g, '')}`
    if (!SUBJECT_ID_PATTERN.test(subjectId)) return reply(422, { detail: 'Invalid subject_id' })
    if (this.subjects.has(subjectId)) return reply(409, { detail: `Subject ${subjectId} already exists` })

    const content = decodeClip(file.data)
    const subject: StoredSubject = {
      id: subjectId,
      filename: file.filename,
      createdAt: new Date().toISOString(),
      ...content,
      prediction: null,
    }
    this.subjects.set(subjectId, subject)
    call.storedAs = subjectId
    subjectId = subject.id
    return reply(200, {
      subject_id: subjectId,
      filename: subject.filename,
      num_frames: subject.frames.length,
      keypoint_format: 'BODY_25',
      ...(this.switches.mode === 'v2' ? { video: this.videoInfo(subject) } : {}),
      saved: { subject_dir: `storage/asd_subjects/${subjectId}` },
    })
  }

  private async pipeline(req: http.IncomingMessage, res: http.ServerResponse, url: URL, body: Buffer) {
    this.pipelineCalls += 1
    const file = parseMultipartFile(req.headers['content-type'] ?? '', body)
    if (!file) return sendJson(res, 400, { detail: 'No video uploaded' })
    const subjectId = url.searchParams.get('subject_id') ?? randomUUID()
    if (this.subjects.has(subjectId)) return sendJson(res, 409, { detail: `Subject ${subjectId} already exists` })
    const content = decodeClip(file.data)
    const subject: StoredSubject = {
      id: subjectId,
      filename: file.filename,
      createdAt: new Date().toISOString(),
      ...content,
      prediction: fakePrediction(subjectId),
    }
    this.subjects.set(subjectId, subject)
    return sendJson(res, 200, {
      subject_id: subjectId,
      filename: subject.filename,
      num_frames: subject.frames.length,
      keypoint_format: 'BODY_25',
      prediction: subject.prediction,
      ...(this.switches.mode === 'v2' ? { video: this.videoInfo(subject) } : {}),
      ...(url.searchParams.get('return_keypoints') === 'true' ? { frames: subject.frames } : {}),
    })
  }

  private metadata(s: StoredSubject) {
    return {
      subject_id: s.id,
      filename: s.filename,
      created_at: s.createdAt,
      keypoint_format: 'BODY_25',
      num_frames: s.frames.length,
      status: 'completed',
      has_prediction: s.prediction !== null,
      ...(this.switches.mode === 'v2' ? { video: this.videoInfo(s), video_retention: 'none' } : {}),
    }
  }

  private videoInfo(s: StoredSubject) {
    return {
      fps: s.fps,
      width: s.width,
      height: s.height,
      frame_count: s.frames.length,
      duration_sec: s.frames.length / s.fps,
    }
  }
}

// ---------------------------------------------------------------------------
// Clip payloads
// ---------------------------------------------------------------------------

export type ClipPayload =
  | { slug: string; scenario: ScenarioName; seed?: number }
  | { template: string }
  | { screening: true }

export function encodeClip(payload: ClipPayload): Buffer {
  return Buffer.from(JSON.stringify(payload), 'utf8')
}

function decodeClip(data: Buffer): { frames: OpenPoseKeypointFrame[]; fps: number; width: number; height: number } {
  let payload: Record<string, unknown>
  try {
    payload = JSON.parse(data.toString('utf8'))
  } catch {
    throw new Error('clip is not a JSON scenario')
  }
  if (typeof payload.template === 'string') {
    const builtin = BUILTIN_EXERCISES.find((b) => b.slug === payload.template)
    if (!builtin) throw new Error(`unknown template ${payload.template}`)
    return { frames: builtin.makeFrames(), fps: builtin.fps, ...BUILTIN_VIDEO_SIZE }
  }
  if (payload.screening === true) {
    const clip = buildScenario('buoc-deu', 'identical', { seed: 5 })
    return { frames: clip.frames, fps: clip.fps, width: clip.width, height: clip.height }
  }
  const slug = String(payload.slug)
  const scenario = String(payload.scenario) as ScenarioName
  if (!SCENARIO_NAMES.includes(scenario)) throw new Error(`unknown scenario ${scenario}`)
  const clip = buildScenario(slug, scenario, { seed: typeof payload.seed === 'number' ? payload.seed : 1 })
  return { frames: clip.frames, fps: clip.fps, width: clip.width, height: clip.height }
}

function fakePrediction(subjectId: string) {
  return {
    file: `${subjectId}.json`,
    T_in: 300,
    J: 25,
    p_typical: 0.8,
    p_asd: 0.2,
    threshold: 0.5,
    temperature: 1,
    label_name: 'typical',
  }
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

function sendJson(res: http.ServerResponse, status: number, payload: unknown) {
  const text = JSON.stringify(payload)
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(text) })
  res.end(text)
}

function readBody(req: http.IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(c))
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

/** The first file part of a multipart/form-data body (enough for one `video` field). */
export function parseMultipartFile(
  contentType: string,
  body: Buffer,
): { filename: string; contentType: string; data: Buffer } | null {
  const match = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType)
  if (!match) return null
  const boundary = Buffer.from(`--${match[1] ?? match[2]}`)
  let pos = body.indexOf(boundary)
  while (pos !== -1) {
    const headerStart = pos + boundary.length + 2 // skip CRLF
    const headerEnd = body.indexOf('\r\n\r\n', headerStart)
    if (headerEnd === -1) return null
    const next = body.indexOf(boundary, headerEnd)
    if (next === -1) return null
    const headers = body.subarray(headerStart, headerEnd).toString('utf8')
    const filename = /filename="([^"]*)"/i.exec(headers)?.[1]
    if (filename !== undefined) {
      const type = /content-type:\s*([^\r\n]+)/i.exec(headers)?.[1]?.trim() ?? 'application/octet-stream'
      return { filename, contentType: type, data: body.subarray(headerEnd + 4, next - 2) }
    }
    pos = next
  }
  return null
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
