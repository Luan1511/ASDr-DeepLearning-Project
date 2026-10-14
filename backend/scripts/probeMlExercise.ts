/**
 * Gate G0 (owner-run): check that the deployed ML server can serve exercise
 * clips the way exerciseProcessor.ts uses it, with ONE video of a consenting
 * adult (never a child). Nothing touches the database.
 *
 *   npm run exercises:probe-ml -- <video>             # phone .mp4 or Chrome MediaRecorder .mp4
 *   npm run exercises:probe-ml -- <video.webm> --as-mkv   # may ML 1.0 decode WebM sent as .mkv?
 *
 * Steps: extract with subject id "probe_<uuid>", fetch the keypoints, delete
 * the subject, verify it is gone. Prints JSON without file names. For the
 * "raise the right hand" recording, rightWristMoves must be true.
 */
import 'dotenv/config'
import fs from 'fs'
import path from 'path'
import { randomUUID } from 'crypto'
import { env } from '../src/lib/env'
import { chooseMlUpload } from '../src/lib/exerciseInput'
import { OpenPoseApiError, openposeService, type OpenPoseKeypointFrame } from '../src/services/openposeService'

const MIN_CONFIDENCE = 0.3

function describeError(error: unknown) {
  if (error instanceof OpenPoseApiError) return { kind: error.kind, status: error.status ?? null, detail: error.detail ?? null }
  return { kind: 'unexpected', status: null, detail: error instanceof Error ? error.message : String(error) }
}

/** Fragmented MP4 (MediaRecorder output) has a top-level "moof" box. */
function isFragmentedMp4(filePath: string): boolean {
  const fd = fs.openSync(filePath, 'r')
  try {
    const size = fs.fstatSync(fd).size
    const header = Buffer.alloc(16)
    let offset = 0
    for (let boxes = 0; offset + 8 <= size && boxes < 10_000; boxes += 1) {
      fs.readSync(fd, header, 0, 16, offset)
      let boxSize = header.readUInt32BE(0)
      const type = header.toString('latin1', 4, 8)
      if (type === 'moof') return true
      if (boxSize === 1) boxSize = Number(header.readBigUInt64BE(8))
      else if (boxSize === 0) break
      if (boxSize < 8) break
      offset += boxSize
    }
    return false
  } finally {
    fs.closeSync(fd)
  }
}

function joint(person: OpenPoseKeypointFrame['people'][number], id: number) {
  const j = person.body25.find((p) => p.id === id)
  return j && j.confidence >= MIN_CONFIDENCE && (j.x !== 0 || j.y !== 0) ? j : null
}

/**
 * Range of the right wrist (BODY_25 id 4) height relative to the neck, in
 * torso lengths, on the most confident person of each frame.
 */
function rightWristMotion(frames: OpenPoseKeypointFrame[]): number | null {
  const rel: number[] = []
  for (const frame of frames) {
    const person = [...(frame.people ?? [])].sort(
      (a, b) =>
        b.body25.reduce((s, j) => s + j.confidence, 0) - a.body25.reduce((s, j) => s + j.confidence, 0),
    )[0]
    if (!person) continue
    const neck = joint(person, 1)
    const hip = joint(person, 8)
    const wrist = joint(person, 4)
    if (!neck || !hip || !wrist) continue
    const torso = Math.hypot(neck.x - hip.x, neck.y - hip.y)
    if (torso > 0) rel.push((neck.y - wrist.y) / torso)
  }
  if (rel.length < 5) return null
  rel.sort((a, b) => a - b)
  const p = (q: number) => rel[Math.min(rel.length - 1, Math.max(0, Math.round(q * (rel.length - 1))))]
  return Math.round((p(0.95) - p(0.05)) * 1000) / 1000
}

async function main() {
  const args = process.argv.slice(2)
  const asMkv = args.includes('--as-mkv')
  const videoArg = args.find((a) => !a.startsWith('--'))
  if (!videoArg) {
    console.error('Usage: npm run exercises:probe-ml -- <video> [--as-mkv]')
    process.exitCode = 2
    return
  }
  const filePath = path.resolve(videoArg)
  if (!fs.existsSync(filePath)) {
    console.error('Video not found.')
    process.exitCode = 2
    return
  }

  const ext = path.extname(filePath).toLowerCase()
  const upload = asMkv
    ? { filename: 'session.mkv', mimeType: 'video/x-matroska' }
    : chooseMlUpload({ ext, legacy: false, webmAsMkv: false })
  if (upload === 'UNSUPPORTED') {
    console.error('Unsupported extension (use .mp4, .mov, .mkv or .webm).')
    process.exitCode = 2
    return
  }

  let legacy: boolean | null = null
  try {
    legacy = (await openposeService.getHealth()) === null
  } catch {
    legacy = null
  }

  const requestedId = `probe_${randomUUID()}`
  const startedAt = Date.now()
  const report: Record<string, unknown> = {
    mlLegacy: legacy,
    sentAs: path.extname(upload.filename),
    fragmentedMp4: ext === '.mp4' || ext === '.mov' ? isFragmentedMp4(filePath) : null,
  }
  let createdId: string | null = null

  try {
    const extract = await openposeService.extractSubject({
      filePath,
      originalFilename: upload.filename,
      mimeType: upload.mimeType,
      subjectId: requestedId,
      timeoutMs: env.EXERCISE_EXTRACT_TIMEOUT_MS,
    })
    createdId = extract.subject_id || requestedId
    report.subjectIdHonoured = extract.subject_id === requestedId

    const keypoints = await openposeService.getSubjectKeypoints(createdId)
    const frames = keypoints.frames ?? []
    const withPerson = frames.filter((f) => (f.people ?? []).length > 0).length
    report.numFrames = frames.length
    report.framesWithPerson = withPerson
    report.framesOk = frames.length > 0 && withPerson / frames.length >= 0.5
    report.fpsReported = keypoints.video?.fps ?? extract.video?.fps ?? null
    const motion = rightWristMotion(frames)
    report.rightWristMotion = motion
    report.rightWristMoves = motion === null ? null : motion >= 0.3
    if (report.fragmentedMp4 === true) report.mp4FragmentedOk = report.framesOk
    if (asMkv) report.webmAsMkvOk = report.framesOk
  } catch (error) {
    report.extractError = describeError(error)
    report.framesOk = false
  }

  if (createdId) {
    try {
      await openposeService.deleteSubject(createdId)
      report.deleteOk = true
    } catch (error) {
      report.deleteOk = false
      report.deleteError = describeError(error)
    }
    try {
      await openposeService.getSubject(createdId)
      report.deleteVerified = false
    } catch (error) {
      report.deleteVerified = error instanceof OpenPoseApiError && error.kind === 'http' && error.status === 404
    }
  } else {
    // Extraction failed before the id was known: try the requested one anyway.
    await openposeService.deleteSubject(requestedId).catch(() => {})
  }

  report.elapsedMs = Date.now() - startedAt
  console.log(JSON.stringify(report, null, 2))
  if (!report.framesOk || report.deleteOk === false || report.deleteVerified === false) process.exitCode = 1
}

main().catch((error) => {
  console.error(describeError(error))
  process.exitCode = 1
})
