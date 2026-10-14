/**
 * E2E harness (spec §7.2). Everything runs on this machine against throwaway
 * resources, never the shared team database:
 *
 * - a temporary PostgreSQL cluster under %TEMP% (C:\Program Files\PostgreSQL\15\bin,
 *   port 55432, trust auth, listening on 127.0.0.1 only);
 * - `prisma migrate deploy` with an explicit DATABASE_URL, run from a copy of
 *   prisma/ inside the temp folder (so backend/.env and prisma.config.ts are
 *   never read), after `prisma migrate status` confirmed the datasource is
 *   127.0.0.1:55432;
 * - the backend (src/server.ts through tsx) on :4100 with cwd = a temp folder
 *   (no backend/.env, uploads land in the temp folder) and an explicit env;
 * - the Node fake ML server on :8100 (fakeMlServer.ts).
 *
 * It aborts if any database URL it would use (or DATABASE_URL in the
 * environment) points at the shared database host.
 */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import type { PrismaClient as PrismaClientType } from '@prisma/client'
import jwt from 'jsonwebtoken'
import { FakeMlServer, encodeClip, type ClipPayload } from './fakeMlServer'

export const SHARED_DB_HOST = '100.104.148.57'
export const PG_BIN = 'C:\\Program Files\\PostgreSQL\\15\\bin'
export const PG_PORT = 55432
export const BACKEND_PORT = 4100
export const ML_PORT = 8100
export const FORBIDDEN_PORTS = [4000, 5173]
export const JWT_SECRET = 'e2e-only-secret-not-used-anywhere-else'

export const BACKEND_DIR = path.resolve(__dirname, '..', '..')
const PRISMA_CLI = path.join(BACKEND_DIR, 'node_modules', 'prisma', 'build', 'index.js')
const TSX_CLI = path.join(BACKEND_DIR, 'node_modules', 'tsx', 'dist', 'cli.mjs')
const SERVER_TS = path.join(BACKEND_DIR, 'src', 'server.ts')

/** Migrations that existed before Giai đoạn 4 (for the unmigrated-DB and old-client scenarios). */
export const PRE_CHANGE_MIGRATIONS = [
  '20260521_init',
  '20260926_add_screening_error_message',
  '20261005_screening_privacy_queue',
]

if ((process.env.DATABASE_URL ?? '').includes(SHARED_DB_HOST)) {
  throw new Error(`E2E ABORTED: DATABASE_URL in the environment points at the shared database (${SHARED_DB_HOST}).`)
}

/** Throws unless the URL is the temp cluster on 127.0.0.1:55432. */
export function assertSafeDatabaseUrl(url: string) {
  if (url.includes(SHARED_DB_HOST)) throw new Error(`E2E ABORTED: refusing to use the shared database (${SHARED_DB_HOST}).`)
  if (!url.startsWith(`postgresql://postgres@127.0.0.1:${PG_PORT}/`)) {
    throw new Error(`E2E ABORTED: database URL is not the temp cluster on 127.0.0.1:${PG_PORT}`)
  }
}

export function dbUrl(database: string) {
  const url = `postgresql://postgres@127.0.0.1:${PG_PORT}/${database}?schema=public`
  assertSafeDatabaseUrl(url)
  return url
}

// ---------------------------------------------------------------------------
// Processes
// ---------------------------------------------------------------------------

/** Minimal environment for child processes: nothing from the caller's DATABASE_URL & co. */
function baseEnv(extra: Record<string, string>): NodeJS.ProcessEnv {
  const keep = [
    'PATH', 'Path', 'PATHEXT', 'SystemRoot', 'SYSTEMROOT', 'SystemDrive', 'windir', 'ComSpec', 'TEMP', 'TMP',
    'USERPROFILE', 'HOMEDRIVE', 'HOMEPATH', 'APPDATA', 'LOCALAPPDATA', 'ProgramFiles', 'ProgramData',
    'NUMBER_OF_PROCESSORS', 'PROCESSOR_ARCHITECTURE', 'OS',
  ]
  const env: NodeJS.ProcessEnv = {}
  for (const key of keep) if (process.env[key] !== undefined) env[key] = process.env[key]
  env.CHECKPOINT_DISABLE = '1'
  env.PRISMA_HIDE_UPDATE_MESSAGE = '1'
  for (const [k, v] of Object.entries(extra)) {
    if (k === 'DATABASE_URL') assertSafeDatabaseUrl(v)
    env[k] = v
  }
  return env
}

type RunResult = { code: number | null; stdout: string; stderr: string }

function run(cmd: string, args: string[], opts: { cwd?: string; env?: Record<string, string>; timeoutMs?: number } = {}) {
  return new Promise<RunResult>((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd: opts.cwd,
      env: baseEnv(opts.env ?? {}),
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    child.stdout!.on('data', (d) => (stdout += d.toString()))
    child.stderr!.on('data', (d) => (stderr += d.toString()))
    const timer = setTimeout(() => {
      killTree(child.pid)
      reject(new Error(`${path.basename(cmd)} ${args.join(' ')} timed out`))
    }, opts.timeoutMs ?? 180_000)
    child.on('error', (e) => {
      clearTimeout(timer)
      reject(e)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ code, stdout, stderr })
    })
  })
}

async function runOk(cmd: string, args: string[], opts: Parameters<typeof run>[2] = {}) {
  const r = await run(cmd, args, opts)
  if (r.code !== 0) throw new Error(`${path.basename(cmd)} ${args.join(' ')} failed (${r.code}):\n${r.stdout}\n${r.stderr}`)
  return r
}

/** Kill a process and everything it started (tsx spawns a child node). */
export function killTree(pid: number | undefined) {
  if (!pid) return
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
  } else {
    try {
      process.kill(pid, 'SIGKILL')
    } catch {
      // already gone
    }
  }
}

export function portInUse(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host: '127.0.0.1' })
    socket.once('connect', () => {
      socket.destroy()
      resolve(true)
    })
    socket.once('error', () => resolve(false))
    socket.setTimeout(1000, () => {
      socket.destroy()
      resolve(false)
    })
  })
}

export function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Polls `fn` until it returns a truthy value. */
export async function waitFor<T>(
  fn: () => Promise<T | null | undefined | false> | T | null | undefined | false,
  opts: { timeoutMs?: number; intervalMs?: number; what?: string } = {},
): Promise<T> {
  const deadline = Date.now() + (opts.timeoutMs ?? 30_000)
  let last: unknown
  for (;;) {
    try {
      const value = await fn()
      if (value) return value as T
    } catch (error) {
      last = error
    }
    if (Date.now() > deadline) {
      throw new Error(`timed out waiting for ${opts.what ?? 'condition'}${last ? `: ${(last as Error).message}` : ''}`)
    }
    await sleep(opts.intervalMs ?? 200)
  }
}

// ---------------------------------------------------------------------------
// HTTP client
// ---------------------------------------------------------------------------

export type ApiResponse<T = any> = { status: number; body: T; headers: Headers }

export async function api<T = any>(
  method: string,
  urlPath: string,
  opts: { token?: string; json?: unknown; form?: FormData } = {},
): Promise<ApiResponse<T>> {
  const headers: Record<string, string> = {}
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`
  let body: string | FormData | undefined
  if (opts.json !== undefined) {
    headers['Content-Type'] = 'application/json'
    body = JSON.stringify(opts.json)
  } else if (opts.form) {
    body = opts.form
  }
  const res = await fetch(`http://127.0.0.1:${BACKEND_PORT}/api${urlPath}`, { method, headers, body })
  const text = await res.text()
  let parsed: any = text
  try {
    parsed = text ? JSON.parse(text) : null
  } catch {
    // keep text
  }
  return { status: res.status, body: parsed as T, headers: res.headers }
}

/** Multipart body with a synthetic "video" (a JSON scenario the fake ML understands). */
export function clipForm(
  clip: ClipPayload,
  fields: Record<string, string | number | boolean | undefined>,
  file: { name?: string; type?: string } = {},
): FormData {
  const form = new FormData()
  for (const [k, v] of Object.entries(fields)) if (v !== undefined) form.append(k, String(v))
  const data = encodeClip(clip)
  form.append(
    'video',
    new Blob([new Uint8Array(data)], { type: file.type ?? 'video/mp4' }),
    file.name ?? 'quay-thu.mp4',
  )
  return form
}

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

export type SeededUser = { id: string; email: string; name: string; role: 'ADMIN' | 'USER'; token: string }

export interface BackendEnv {
  db?: 'main' | 'old'
  /** Folder name (under the temp root) used as the backend's cwd. */
  cwdName?: string
  env?: Record<string, string>
}

export class E2eHarness {
  readonly root: string
  readonly pgData: string
  readonly ml = new FakeMlServer(ML_PORT)
  readonly mainDb = 'aimbrace_e2e'
  readonly oldDb = 'aimbrace_e2e_premigration'
  prisma!: PrismaClientType
  users!: { admin: SeededUser; parentA: SeededUser; parentB: SeededUser }
  backendCwd = ''
  backendLog: string[] = []
  /** Every line of every backend run of this harness. */
  allBackendLogs: string[] = []

  private pgStarted = false
  private backend: ChildProcess | null = null
  private extraClients: PrismaClientType[] = []
  private exitHook = () => this.emergencyCleanup()

  constructor(readonly label: string) {
    this.root = fs.mkdtempSync(path.join(os.tmpdir(), `aimbrace-e2e-${label}-`))
    this.pgData = path.join(this.root, 'pgdata')
    process.on('exit', this.exitHook)
  }

  get mainUrl() {
    return dbUrl(this.mainDb)
  }

  get oldUrl() {
    return dbUrl(this.oldDb)
  }

  /** Temp cluster + migrated main DB + seed + fake ML (backend is started separately). */
  async setup(options: { premigrationDb?: boolean } = {}) {
    for (const port of [PG_PORT, BACKEND_PORT, ML_PORT]) {
      if (await portInUse(port)) throw new Error(`E2E ABORTED: port ${port} is already in use`)
    }
    await this.startPostgres()
    await this.createDatabase(this.mainDb)
    await this.migrate(this.mainUrl, path.join(this.root, 'prisma-main'))
    if (options.premigrationDb) {
      await this.createDatabase(this.oldDb)
      await this.migrate(this.oldUrl, path.join(this.root, 'prisma-premigration'), PRE_CHANGE_MIGRATIONS)
    }
    this.prisma = this.client(this.mainUrl)
    await this.seed()
    await this.ml.start()
  }

  /** A Prisma client bound explicitly to a temp database. */
  client(url: string): PrismaClientType {
    assertSafeDatabaseUrl(url)
    // Set before the client loads (it reads backend/.env without overriding existing variables).
    process.env.DATABASE_URL = url
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { PrismaClient } = require('@prisma/client') as typeof import('@prisma/client')
    const client = new PrismaClient({ datasourceUrl: url })
    this.extraClients.push(client)
    return client
  }

  private async startPostgres() {
    const pgLog = path.join(this.root, 'postgres.log')
    await runOk(path.join(PG_BIN, 'initdb.exe'), ['-D', this.pgData, '-U', 'postgres', '-A', 'trust', '-E', 'UTF8', '--no-locale'], {
      timeoutMs: 120_000,
    })
    // stdio ignored: the postmaster must not inherit our pipes.
    const code = await new Promise<number | null>((resolve, reject) => {
      const child = spawn(
        path.join(PG_BIN, 'pg_ctl.exe'),
        ['-D', this.pgData, '-l', pgLog, '-w', '-t', '60', '-o', `-p ${PG_PORT} -c listen_addresses=127.0.0.1 -c fsync=off`, 'start'],
        { env: baseEnv({}), windowsHide: true, stdio: 'ignore' },
      )
      child.on('error', reject)
      child.on('exit', resolve)
    })
    this.pgStarted = true
    if (code !== 0) {
      const log = fs.existsSync(pgLog) ? fs.readFileSync(pgLog, 'utf8') : ''
      throw new Error(`pg_ctl start failed (${code}):\n${log}`)
    }
  }

  private async createDatabase(name: string) {
    await runOk(path.join(PG_BIN, 'createdb.exe'), ['-h', '127.0.0.1', '-p', String(PG_PORT), '-U', 'postgres', name])
  }

  /**
   * Copies schema.prisma + the migrations into `dir` and deploys them from
   * there with an explicit DATABASE_URL (no backend/.env, no prisma.config.ts).
   */
  async migrate(url: string, dir: string, only?: string[]) {
    assertSafeDatabaseUrl(url)
    const src = path.join(BACKEND_DIR, 'prisma')
    fs.mkdirSync(path.join(dir, 'migrations'), { recursive: true })
    fs.copyFileSync(path.join(src, 'schema.prisma'), path.join(dir, 'schema.prisma'))
    fs.copyFileSync(path.join(src, 'migrations', 'migration_lock.toml'), path.join(dir, 'migrations', 'migration_lock.toml'))
    for (const name of fs.readdirSync(path.join(src, 'migrations'))) {
      const from = path.join(src, 'migrations', name)
      if (!fs.statSync(from).isDirectory()) continue
      if (only && !only.includes(name)) continue
      fs.cpSync(from, path.join(dir, 'migrations', name), { recursive: true })
    }
    const schema = path.join(dir, 'schema.prisma')
    const env = { DATABASE_URL: url }
    const status = await run(process.execPath, [PRISMA_CLI, 'migrate', 'status', '--schema', schema], { cwd: dir, env })
    const output = `${status.stdout}\n${status.stderr}`
    if (!output.includes(`127.0.0.1:${PG_PORT}`) || output.includes(SHARED_DB_HOST)) {
      throw new Error(`E2E ABORTED: prisma migrate status did not report the temp datasource:\n${output}`)
    }
    await runOk(process.execPath, [PRISMA_CLI, 'migrate', 'deploy', '--schema', schema], { cwd: dir, env })
  }

  /** Runs the repo's Prisma CLI with an explicit DATABASE_URL from a temp cwd. */
  prismaCli(args: string[], url: string, cwd: string) {
    assertSafeDatabaseUrl(url)
    return run(process.execPath, [PRISMA_CLI, ...args], { cwd, env: { DATABASE_URL: url } })
  }

  private async seed() {
    const make = async (key: string, name: string, role: 'ADMIN' | 'USER'): Promise<SeededUser> => {
      const email = `${key}@e2e.test`
      // No usable password: tests sign their own JWTs.
      const user = await this.prisma.user.create({ data: { name, email, role, passwordHash: '!e2e-no-login' } })
      return { id: user.id, email, name, role, token: this.tokenFor({ id: user.id, email, name, role }) }
    }
    this.users = {
      admin: await make('e2e-admin', 'Quản trị E2E', 'ADMIN'),
      parentA: await make('e2e-parent-a', 'Phụ huynh E2E A', 'USER'),
      parentB: await make('e2e-parent-b', 'Phụ huynh E2E B', 'USER'),
    }
  }

  tokenFor(u: { id: string; email: string; name: string; role: string }) {
    return jwt.sign({ email: u.email, name: u.name, role: u.role }, JWT_SECRET, { subject: u.id, expiresIn: '2h' })
  }

  /** Synthetic child with a date of birth `ageMonths` months (and `extraDays` days) before today (UTC). */
  async createChild(owner: SeededUser, label: string, ageMonths = 36, extraDays = 0) {
    const now = new Date()
    const dob = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - ageMonths, now.getUTCDate() - extraDays))
    return this.prisma.childProfile.create({
      data: { userId: owner.id, fullName: `Bé ${label} (E2E)`, dateOfBirth: dob, gender: 'UNSPECIFIED' },
    })
  }

  // -------------------------------------------------------------------------
  // Backend
  // -------------------------------------------------------------------------

  async startBackend(opts: BackendEnv = {}) {
    if (this.backend) await this.stopBackend()
    for (const port of FORBIDDEN_PORTS) if (port === BACKEND_PORT) throw new Error('forbidden port')
    if (await portInUse(BACKEND_PORT)) throw new Error(`port ${BACKEND_PORT} is busy`)
    const url = opts.db === 'old' ? this.oldUrl : this.mainUrl
    this.backendCwd = path.join(this.root, opts.cwdName ?? 'backend-cwd')
    fs.mkdirSync(this.backendCwd, { recursive: true })
    const env: Record<string, string> = {
      NODE_ENV: 'test',
      PORT: String(BACKEND_PORT),
      DATABASE_URL: url,
      JWT_SECRET,
      JWT_EXPIRES_IN: '2h',
      CORS_ORIGIN: `http://127.0.0.1:${BACKEND_PORT}`,
      MAX_UPLOAD_MB: '50',
      SKELETON_MAX_UPLOAD_MB: '50',
      OPENPOSE_SERVER_URL: `http://127.0.0.1:${ML_PORT}`,
      EXTRACT_API_URL: `http://127.0.0.1:${ML_PORT}/pipeline/asd`,
      OPENPOSE_API_KEY: '',
      EXTRACT_API_TIMEOUT_MS: '60000',
      BYPASS_EXTRACT_API: 'false',
      ML_MAX_CONCURRENCY: '1',
      SCREENING_MAX_ATTEMPTS: '3',
      SCREENING_POLL_INTERVAL_MS: '500',
      SCREENING_THRESHOLD: '',
      SCREENING_TEMPERATURE: '',
      SCREENING_HIGH_RISK_THRESHOLD: '0.7',
      RETAIN_UPLOADED_VIDEOS: 'false',
      CHAT_API_BASE_URL: `http://127.0.0.1:${ML_PORT}`,
      EXERCISE_MODE: 'on',
      EXERCISE_WORKER_ENABLED: 'true',
      EXERCISE_MAX_UPLOAD_MB: '20',
      EXERCISE_MAX_DURATION_SEC: '60',
      EXERCISE_MAX_PENDING_PER_CHILD: '3',
      EXERCISE_MAX_ATTEMPTS: '3',
      EXERCISE_EXTRACT_TIMEOUT_MS: '60000',
      EXERCISE_POLL_INTERVAL_MS: '500',
      EXERCISE_WEBM_AS_MKV: 'false',
      MCHAT_MODE: 'entry',
      ...(opts.env ?? {}),
    }
    const logFile = fs.createWriteStream(path.join(this.root, `backend-${Date.now()}.log`))
    this.backendLog = []
    const child = spawn(process.execPath, [TSX_CLI, SERVER_TS], {
      cwd: this.backendCwd,
      env: baseEnv(env),
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    this.backend = child
    const onData = (d: Buffer) => {
      const text = d.toString()
      logFile.write(text)
      const lines = text.split(/\r?\n/).filter(Boolean)
      this.backendLog.push(...lines)
      this.allBackendLogs.push(...lines)
    }
    child.stdout!.on('data', onData)
    child.stderr!.on('data', onData)
    child.on('exit', () => logFile.end())
    await waitFor(
      async () => {
        if (child.exitCode !== null) throw new Error(`backend exited early:\n${this.backendLog.slice(-30).join('\n')}`)
        const res = await fetch(`http://127.0.0.1:${BACKEND_PORT}/api/health`).catch(() => null)
        return res?.ok ?? false
      },
      { timeoutMs: 60_000, intervalMs: 300, what: 'backend /api/health' },
    )
  }

  async stopBackend() {
    const child = this.backend
    this.backend = null
    if (!child || child.exitCode !== null) return
    const exited = new Promise((resolve) => child.once('exit', resolve))
    killTree(child.pid)
    await Promise.race([exited, sleep(10_000)])
    await waitFor(async () => !(await portInUse(BACKEND_PORT)), { timeoutMs: 15_000, what: 'port 4100 to close' })
  }

  logContains(pattern: string | RegExp) {
    return this.backendLog.some((l) => (typeof pattern === 'string' ? l.includes(pattern) : pattern.test(l)))
  }

  /** Files currently in the backend's uploads/exercises folder (top level). */
  exerciseFiles(): string[] {
    const dir = path.join(this.backendCwd, 'uploads', 'exercises')
    if (!fs.existsSync(dir)) return []
    return fs.readdirSync(dir).filter((f) => fs.statSync(path.join(dir, f)).isFile())
  }

  exerciseFileExists(filePath: string) {
    return fs.existsSync(path.resolve(this.backendCwd, filePath))
  }

  // -------------------------------------------------------------------------
  // Teardown
  // -------------------------------------------------------------------------

  async teardown() {
    process.off('exit', this.exitHook)
    await this.stopBackend().catch(() => {})
    await this.ml.stop().catch(() => {})
    for (const c of this.extraClients) await c.$disconnect().catch(() => {})
    this.extraClients = []
    this.stopPostgresSync()
    for (let i = 0; i < 10; i += 1) {
      try {
        fs.rmSync(this.root, { recursive: true, force: true })
        break
      } catch {
        await sleep(500)
      }
    }
  }

  private stopPostgresSync() {
    if (!this.pgStarted) return
    this.pgStarted = false
    spawnSync(path.join(PG_BIN, 'pg_ctl.exe'), ['-D', this.pgData, '-m', 'fast', '-w', '-t', '30', 'stop'], {
      env: baseEnv({}),
      windowsHide: true,
      stdio: 'ignore',
    })
  }

  /** process 'exit' fallback when a test run is interrupted. */
  private emergencyCleanup() {
    if (this.backend?.pid) killTree(this.backend.pid)
    this.stopPostgresSync()
    try {
      fs.rmSync(this.root, { recursive: true, force: true })
    } catch {
      // best effort
    }
  }
}
