import { randomBytes } from 'node:crypto'
import type { Prisma, PrismaClient } from '@prisma/client'

async function friendlyCommunityName(db: PrismaClient | Prisma.TransactionClient) {
  const friendlyNames = ['Mầm Xanh', 'Nắng Mai', 'Cánh Diều', 'Mây Nhỏ', 'Sao Nhỏ', 'Lá Non', 'Hoa Nắng', 'Biển Xanh']
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const bytes = randomBytes(3)
    const generated = `Gia đình ${friendlyNames[bytes[0] % friendlyNames.length]} ${(bytes.readUInt16BE(1) % 10000).toString().padStart(4, '0')}`
    const taken = await db.communityProfile.findUnique({ where: { displayName: generated }, select: { userId: true } })
    if (!taken) return generated
  }
  const suffix = randomBytes(3).toString('hex').toUpperCase()
  return `Gia đình AIMBRACE ${suffix}`
}

export async function ensureCommunityProfile(db: PrismaClient | Prisma.TransactionClient, userId: string, displayName?: string) {
  const current = await db.communityProfile.findUnique({ where: { userId } })
  if (current) {
    if (displayName === 'Phụ huynh' && /^Phụ huynh [A-F0-9]{6}$/.test(current.displayName)) {
      const replacement = await friendlyCommunityName(db)
      return db.communityProfile.update({ where: { userId }, data: { displayName: replacement } })
    }
    return current
  }
  if (!displayName) return null
  if (displayName !== 'Phụ huynh') {
    const suffix = randomBytes(3).toString('hex').toUpperCase()
    return db.communityProfile.create({ data: { userId, displayName: `${displayName} ${suffix}` } })
  }
  const generated = await friendlyCommunityName(db)
  return db.communityProfile.create({ data: { userId, displayName: generated } })
}

export function communityAuthorName(user: { id: string; name: string; communityProfile?: { displayName: string } | null }, _viewerId: string, isAnonymous: boolean) {
  if (isAnonymous) return 'Phụ huynh giấu tên'
  return user.communityProfile?.displayName ?? `Thành viên ${user.id.slice(-5).toUpperCase()}`
}

export async function notifyUsers(
  db: PrismaClient | Prisma.TransactionClient,
  userIds: string[],
  input: { type: string; actorId: string; postId?: string; commentId?: string; groupId?: string },
) {
  const recipients = Array.from(new Set(userIds)).filter((id) => id !== input.actorId)
  if (!recipients.length) return
  await db.communityNotification.createMany({
    data: recipients.map((userId) => ({ userId, ...input })),
  })
}

export async function communityBlockedUserIds(db: PrismaClient | Prisma.TransactionClient, userId: string): Promise<string[]> {
  const blocks = await db.communityBlock.findMany({
    where: { OR: [{ blockerId: userId }, { blockedId: userId }] },
    select: { blockerId: true, blockedId: true },
  })
  return blocks.map((row) => (row.blockerId === userId ? row.blockedId : row.blockerId))
}
