import { z } from 'zod'

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(16),
  JWT_EXPIRES_IN: z.string().default('7d'),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),
  MAX_UPLOAD_MB: z.coerce.number().int().positive().default(200),
  EXTRACT_API_URL: z.string().url().default('https://858a-113-160-235-186.ngrok-free.app/extract'),
  BYPASS_EXTRACT_API: z.preprocess((val) => val === 'true' || val === '1' || val === true, z.boolean()).default(false),
  CHAT_API_BASE_URL: z.string().url().default('https://7289-113-160-235-186.ngrok-free.app'),
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
  EXTRACT_API_URL: process.env.EXTRACT_API_URL,
  BYPASS_EXTRACT_API: process.env.BYPASS_EXTRACT_API,
  CHAT_API_BASE_URL: process.env.CHAT_API_BASE_URL,
})
