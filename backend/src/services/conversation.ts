import type { Prisma } from '@prisma/client'

// The same locks are used by sending, blocking and moderation suspension.
export async function lockCommunityUsers(tx: Prisma.TransactionClient, ids: string[]) {
  for (const id of [...new Set(ids)].sort()) await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${id}))`
}
