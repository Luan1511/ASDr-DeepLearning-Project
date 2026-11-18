/**
 * Creates (or refreshes) the sample doctors of DOCTOR_MODE=demo in the
 * database of backend/.env:
 *
 *   npm run doctors:seed-mock              # dry run: shows what would be done
 *   npm run doctors:seed-mock -- --yes     # writes
 *
 * Only the sample accounts (isMock = true, *@asdr.local) are touched. New
 * accounts get the password in MOCK_DOCTOR_PASSWORD; accounts that already
 * exist keep theirs. The sample accounts are for test environments only.
 */
import 'dotenv/config'
import bcrypt from 'bcrypt'
import { PrismaClient } from '@prisma/client'
import { MOCK_DOCTORS, seedMockDoctors } from '../src/lib/mockDoctors'

/** Used when MOCK_DOCTOR_PASSWORD is not set (same spirit as the demo accounts of prisma/seed.ts). */
const DEFAULT_MOCK_DOCTOR_PASSWORD = 'doctor123'

async function main() {
  const write = process.argv.includes('--yes')
  const prisma = new PrismaClient()
  try {
    const existing = await prisma.user.count({ where: { email: { in: MOCK_DOCTORS.map((d) => d.email) } } })
    // eslint-disable-next-line no-console
    console.log(`${MOCK_DOCTORS.length} sample doctors; ${existing} account(s) already exist, ${MOCK_DOCTORS.length - existing} to create.`)
    if (!write) {
      // eslint-disable-next-line no-console
      console.log('Dry run. Run again with "-- --yes" to write.')
      return
    }
    const password = process.env.MOCK_DOCTOR_PASSWORD || DEFAULT_MOCK_DOCTOR_PASSWORD
    const result = await seedMockDoctors(prisma, await bcrypt.hash(password, 10))
    // eslint-disable-next-line no-console
    console.log(
      `Done: ${result.created} created, ${result.updated} refreshed. ` +
        `New accounts use ${process.env.MOCK_DOCTOR_PASSWORD ? 'MOCK_DOCTOR_PASSWORD' : 'the default sample password (see this script)'}.`,
    )
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
