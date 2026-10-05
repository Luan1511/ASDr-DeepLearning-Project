import { Prisma } from '@prisma/client'

/**
 * P2021 = table missing, P2022 = column missing: the database has not had the
 * latest prisma/migrations applied (the code is newer than the schema).
 */
export function isSchemaOutdatedError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && (error.code === 'P2021' || error.code === 'P2022')
}

export const SCHEMA_OUTDATED_HINT =
  'Database schema is older than the code: apply the pending migration(s) in backend/prisma/migrations ' +
  '(see master_prompt.md §5 — the shared DB has a diverged migration history, do NOT run prisma migrate dev).'
