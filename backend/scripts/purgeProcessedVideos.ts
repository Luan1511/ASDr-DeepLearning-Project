/**
 * Delete raw uploads whose screening already COMPLETED (skeleton + result are
 * kept). New uploads are removed automatically after analysis; this script
 * cleans up videos stored before that policy existed.
 *
 *   npm run privacy:purge-videos            # dry run: list what would go
 *   npm run privacy:purge-videos -- --yes   # actually delete
 *
 * Point DATABASE_URL at the database whose uploads live in ./uploads.
 */
import 'dotenv/config'
import fs from 'fs'
import path from 'path'
import { PrismaClient, ScreeningStatus } from '@prisma/client'

const prisma = new PrismaClient()
const execute = process.argv.includes('--yes')

async function main() {
  const uploadsDir = path.join(process.cwd(), 'uploads')
  const candidates = await prisma.videoUpload.findMany({
    where: { status: ScreeningStatus.COMPLETED, videoDeletedAt: null, result: { isNot: null } },
    select: { id: true, filePath: true, fileSize: true },
  })

  let bytes = 0
  let deleted = 0
  let missing = 0
  for (const video of candidates) {
    const fullPath = path.resolve(process.cwd(), video.filePath)
    if (!fullPath.startsWith(uploadsDir + path.sep)) {
      console.warn(`skip ${video.id}: path outside uploads/ (${video.filePath})`)
      continue
    }
    const exists = fs.existsSync(fullPath)
    if (!exists) missing += 1
    else bytes += video.fileSize
    if (!execute) continue
    if (exists) await fs.promises.unlink(fullPath)
    await prisma.videoUpload.update({ where: { id: video.id }, data: { videoDeletedAt: new Date() } })
    deleted += 1
  }

  const referenced = new Set(
    (await prisma.videoUpload.findMany({ select: { storedFilename: true } })).map((v) => v.storedFilename),
  )
  const orphans = fs.existsSync(uploadsDir)
    ? fs.readdirSync(uploadsDir).filter((name) => {
        const full = path.join(uploadsDir, name)
        return fs.statSync(full).isFile() && !referenced.has(name)
      })
    : []

  console.log(
    `${execute ? 'Deleted' : 'Would delete'} ${execute ? deleted : candidates.length} processed uploads ` +
      `(${(bytes / 1024 / 1024).toFixed(1)} MB on disk, ${missing} already missing).`,
  )
  console.log(
    `${orphans.length} file(s) in uploads/ are not referenced by this database (left untouched; they may belong to another database).`,
  )
  if (!execute) console.log('Dry run only. Re-run with --yes to delete.')
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
