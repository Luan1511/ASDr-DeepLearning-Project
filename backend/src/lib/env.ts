import { z } from 'zod'

const booleanFlag = z.preprocess((val) => val === 'true' || val === '1' || val === true, z.boolean())

const optionalNumber = (schema: z.ZodNumber) =>
  z.preprocess((val) => (val === undefined || val === '' ? undefined : val), z.coerce.number().pipe(schema).optional())

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(16),
  JWT_EXPIRES_IN: z.string().default('7d'),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),
  MAX_UPLOAD_MB: z.coerce.number().int().positive().default(1024),
  SKELETON_MAX_UPLOAD_MB: z.coerce.number().int().positive().default(200),
  EXTRACT_API_URL: z.string().url().default('http://localhost:8000/pipeline/asd'),
  OPENPOSE_SERVER_URL: z.string().url().optional(),
  // Shared secret sent as X-API-Key; must match ML_API_KEY on the ML server.
  OPENPOSE_API_KEY: z.string().min(1).optional(),
  EXTRACT_API_TIMEOUT_MS: z.coerce.number().int().positive().default(60 * 60 * 1000),
  BYPASS_EXTRACT_API: booleanFlag.default(false),
  // Heavy OpenPose calls allowed in flight from this process (one GTX 1650 → 1).
  ML_MAX_CONCURRENCY: z.coerce.number().int().min(1).max(8).default(1),
  SCREENING_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(10).default(3),
  SCREENING_POLL_INTERVAL_MS: z.coerce.number().int().min(500).default(3000),
  // When unset the ML server decides (calibration.json, else 0.5 / T=1.0).
  SCREENING_THRESHOLD: optionalNumber(z.number().min(0).max(1)),
  SCREENING_TEMPERATURE: optionalNumber(z.number().positive()),
  // Used only when the ML response carries no high_risk_threshold.
  SCREENING_HIGH_RISK_THRESHOLD: z.coerce.number().min(0).max(1).default(0.7),
  // Keep raw uploads after a successful analysis (default: delete them).
  RETAIN_UPLOADED_VIDEOS: booleanFlag.default(false),
  CHAT_API_BASE_URL: z.string().url().optional(),
  // Giai đoạn 4. off = hidden + worker stopped; admin_only = admins only
  // (default until the scoring is calibrated on adult recordings); on = parents too.
  EXERCISE_MODE: z.enum(['off', 'admin_only', 'on']).default('admin_only'),
  EXERCISE_WORKER_ENABLED: z
    .preprocess((val) => (val === undefined || val === '' ? true : val === 'true' || val === '1' || val === true), z.boolean())
    .default(true),
  EXERCISE_MAX_UPLOAD_MB: z.coerce.number().int().positive().default(100),
  EXERCISE_MAX_DURATION_SEC: z.coerce.number().int().min(10).max(120).default(60),
  EXERCISE_MAX_PENDING_PER_CHILD: z.coerce.number().int().min(1).max(20).default(3),
  EXERCISE_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(5).default(2),
  EXERCISE_EXTRACT_TIMEOUT_MS: z.coerce.number().int().positive().default(10 * 60 * 1000),
  EXERCISE_POLL_INTERVAL_MS: z.coerce.number().int().min(500).default(3000),
  // Send browser .webm recordings to an ML 1.0 server as .mkv (only after the
  // owner's probe confirmed it decodes them).
  EXERCISE_WEBM_AS_MKV: booleanFlag.default(false),
  // M-CHAT-R/F (master_prompt.md §6.8). off until the authors grant permission; entry = answers
  // typed by item number from the official form; inapp = items + automated Follow-Up in the app
  // once the licensed content file is ready (until then it behaves like entry).
  MCHAT_MODE: z.enum(['off', 'entry', 'inapp']).default('off'),
  // Licensed text for inapp (gitignored); relative to the backend folder unless absolute.
  MCHAT_CONTENT_PATH: z.string().trim().min(1).default('content/mchat-rf.vi.json'),
})

export type Env = z.infer<typeof envSchema>

export const env: Env = envSchema.parse({
  NODE_ENV: process.env.NODE_ENV,
  PORT: process.env.PORT,
  DATABASE_URL: process.env.DATABASE_URL,
  JWT_SECRET: process.env.JWT_SECRET,
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN,
  CORS_ORIGIN: process.env.CORS_ORIGIN,
  MAX_UPLOAD_MB: process.env.MAX_UPLOAD_MB,
  SKELETON_MAX_UPLOAD_MB: process.env.SKELETON_MAX_UPLOAD_MB,
  EXTRACT_API_URL: process.env.EXTRACT_API_URL,
  OPENPOSE_SERVER_URL: process.env.OPENPOSE_SERVER_URL,
  OPENPOSE_API_KEY: process.env.OPENPOSE_API_KEY || undefined,
  EXTRACT_API_TIMEOUT_MS: process.env.EXTRACT_API_TIMEOUT_MS,
  BYPASS_EXTRACT_API: process.env.BYPASS_EXTRACT_API,
  ML_MAX_CONCURRENCY: process.env.ML_MAX_CONCURRENCY,
  SCREENING_MAX_ATTEMPTS: process.env.SCREENING_MAX_ATTEMPTS,
  SCREENING_POLL_INTERVAL_MS: process.env.SCREENING_POLL_INTERVAL_MS,
  SCREENING_THRESHOLD: process.env.SCREENING_THRESHOLD,
  SCREENING_TEMPERATURE: process.env.SCREENING_TEMPERATURE,
  SCREENING_HIGH_RISK_THRESHOLD: process.env.SCREENING_HIGH_RISK_THRESHOLD,
  RETAIN_UPLOADED_VIDEOS: process.env.RETAIN_UPLOADED_VIDEOS,
  CHAT_API_BASE_URL: process.env.CHAT_API_BASE_URL,
  EXERCISE_MODE: process.env.EXERCISE_MODE || undefined,
  EXERCISE_WORKER_ENABLED: process.env.EXERCISE_WORKER_ENABLED,
  EXERCISE_MAX_UPLOAD_MB: process.env.EXERCISE_MAX_UPLOAD_MB,
  EXERCISE_MAX_DURATION_SEC: process.env.EXERCISE_MAX_DURATION_SEC,
  EXERCISE_MAX_PENDING_PER_CHILD: process.env.EXERCISE_MAX_PENDING_PER_CHILD,
  EXERCISE_MAX_ATTEMPTS: process.env.EXERCISE_MAX_ATTEMPTS,
  EXERCISE_EXTRACT_TIMEOUT_MS: process.env.EXERCISE_EXTRACT_TIMEOUT_MS,
  EXERCISE_POLL_INTERVAL_MS: process.env.EXERCISE_POLL_INTERVAL_MS,
  EXERCISE_WEBM_AS_MKV: process.env.EXERCISE_WEBM_AS_MKV,
  MCHAT_MODE: process.env.MCHAT_MODE || undefined,
  MCHAT_CONTENT_PATH: process.env.MCHAT_CONTENT_PATH || undefined,
})
