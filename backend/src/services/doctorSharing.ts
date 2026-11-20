import { prisma } from '../lib/prisma'

/** Finalize expired grants so parents can see their expiry in the access history. */
export async function expireDoctorLinks(now = new Date()) {
  const expired = await prisma.doctorChildLink.findMany({ where: { revokedAt: null, expiresAt: { lte: now } }, select: { id: true } })
  for (const link of expired) {
    await prisma.$transaction(async (tx) => {
      const changed = await tx.doctorChildLink.updateMany({ where: { id: link.id, revokedAt: null, expiresAt: { lte: now } }, data: { revokedAt: now } })
      if (changed.count) await tx.doctorAccessEvent.create({ data: { linkId: link.id, type: 'EXPIRED', occurredAt: now } })
    })
  }
  return expired.length
}
