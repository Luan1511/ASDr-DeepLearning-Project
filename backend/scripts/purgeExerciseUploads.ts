/**
 * Clean up exercise videos in uploads/exercises that should no longer exist.
 * The worker deletes them right after scoring and reconcile() removes FAILED
 * ones after 24 h; this script catches the rest (e.g. files of sessions an
 * older backend deleted by cascading a child deletion).
 *
 *   npm run privacy:purge-exercise-uploads            # dry run: list only
 *   npm run privacy:purge-exercise-uploads -- --yes   # actually delete
 *
 * Point DATABASE_URL at the database whose uploads live in ./uploads.
 * Files no session of THIS database references are deleted only with --yes
 * and only when older than 24 h (another database's backend sharing this
 * folder could still be scoring a newer one).
 */
import 'dotenv/config'
import fs from 'fs'
import path from 'path'
import { ExerciseSessionStatus, PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()
const execute = process.argv.includes('--yes')
const DAY_MS = 24 * 60 * 60_000

const exercisesDir = path.join(process.cwd(), 'uploads', 'exercises')
const templatesDir = path.join(exercisesDir, 'templates')

function listFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return []
  return fs
    .readdirSync(dir)
    .map((name) => path.join(dir, name))
    .filter((full) => fs.statSync(full).isFile())
}

function insideExercisesDir(fullPath: string) {
  return fullPath.startsWith(exercisesDir + path.sep)
}

async function main() {
  const cutoff = new Date(Date.now() - DAY_MS)

  // 1. Rows whose video should already be gone.
  const due = await prisma.exerciseSession.findMany({
    where: {
      videoDeletedAt: null,
      OR: [
        { status: { in: [ExerciseSessionStatus.SCORED, ExerciseSessionStatus.INSUFFICIENT] } },
        { status: ExerciseSessionStatus.FAILED, updatedAt: { lt: cutoff } },
      ],
    },
    select: { id: true, filePath: true, fileSize: true },
  })
  let bytes = 0
  let deleted = 0
  for (const session of due) {
    const fullPath = path.resolve(process.cwd(), session.filePath)
    if (!insideExercisesDir(fullPath)) {
      console.warn(`skip session ${session.id}: path outside uploads/exercises`)
      continue
    }
    const exists = fs.existsSync(fullPath)
    if (exists) bytes += session.fileSize
    if (!execute) continue
    if (exists) await fs.promises.unlink(fullPath)
    await prisma.exerciseSession.updateMany({ where: { id: session.id, videoDeletedAt: null }, data: { videoDeletedAt: new Date() } })
    deleted += 1
  }

  // 2. Files no session of this database points to (template uploads are
  //    always temporary, so any left-over one is an orphan too).
  const referenced = new Set(
    (await prisma.exerciseSession.findMany({ where: { videoDeletedAt: null }, select: { storedFilename: true } })).map(
      (s) => s.storedFilename,
    ),
  )
  const orphans = [...listFiles(exercisesDir), ...listFiles(templatesDir)].filter(
    (full) => path.dirname(full) === templatesDir || !referenced.has(path.basename(full)),
  )
  const oldOrphans = orphans.filter((full) => fs.statSync(full).mtime < cutoff)
  let orphansDeleted = 0
  if (execute) {
    for (const full of oldOrphans) {
      await fs.promises.unlink(full)
      orphansDeleted += 1
    }
  }

  console.log(
    `${execute ? 'Deleted' : 'Would delete'} ${execute ? deleted : due.length} exercise video(s) whose session is finished ` +
      `(${(bytes / 1024 / 1024).toFixed(1)} MB on disk).`,
  )
  console.log(
    `${orphans.length} file(s) in uploads/exercises are not referenced by this database; ` +
      `${oldOrphans.length} of them are older than 24 h` +
      (execute ? ` and ${orphansDeleted} were deleted.` : ' and would be deleted.'),
  )
  if (!execute) console.log('Dry run only. Re-run with --yes to delete.')
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
