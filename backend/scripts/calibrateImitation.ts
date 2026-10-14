/**
 * Gate C1 (spec §0.3, §7.4): check imitation-v1 against recordings of
 * consenting ADULT team members before parents can use the exercises.
 * Pure computation on local files: no database, no ML server, no network.
 *
 *   npm run exercises:calibrate -- <folder> [--fps 30] [--policy EITHER|ANATOMICAL_ONLY|MIRROR_ONLY]
 *   npm run exercises:calibrate -- --demo     # synthetic adults: checks the script, NOT a calibration
 *
 * Folder layout (keep it OUTSIDE the repository, never commit it):
 *   <folder>/<exercise-slug>/template.json        optional demonstration; otherwise the built-in with that slug
 *   <folder>/<exercise-slug>/<adult>/<take>.json  one attempt; the take name starts with
 *                                                 good | half | different | still   (e.g. good-1.json)
 * A JSON file is either the ML keypoints response ({ frames, video: { fps, width, height, duration_sec } }),
 * { frames, fps?, durationMs?, recordedVia?, width?, height? }, or a bare array of frames.
 *
 * Pass rule per exercise (C1): ≥ 3 adults, median(good) ≥ 70, median(different) ≤ 40,
 * median(still) ≤ 20, and good > half > different in ≥ 80 % of each adult's triplets.
 * An INSUFFICIENT good/half take counts as 0; INSUFFICIENT different/still takes are
 * left out of the medians (and reported). Adult folder names are never printed.
 */
import fs from 'fs'
import path from 'path'
import type { OpenPoseKeypointFrame } from '../src/services/openposeService'
import {
  BUILTIN_EXERCISES,
  BUILTIN_VIDEO_SIZE,
  buildTemplate,
  resolveExerciseFps,
  scoreImitation,
  type CompiledTemplate,
  type ImitationResult,
  type MirrorPolicyValue,
} from '../src/services/imitation'

const CATEGORIES = ['good', 'half', 'different', 'still'] as const
type Category = (typeof CATEGORIES)[number]

const C1 = { minAdults: 3, goodMedianMin: 70, differentMedianMax: 40, stillMedianMax: 20, orderShareMin: 0.8 }

interface Recording {
  frames: OpenPoseKeypointFrame[]
  fps: number | null
  durationMs: number | null
  recordedVia: 'WEBCAM' | 'UPLOAD'
  width: number | null
  height: number | null
}

interface Take {
  adult: number
  category: Category
  recording: Recording
}

interface ExerciseInput {
  slug: string
  template: CompiledTemplate
  policy: MirrorPolicyValue
  takes: Take[]
}

interface Outcome {
  adult: number
  category: Category
  overall: number | null
  status: ImitationResult['status']
  scoringMs: number
}

function parseArgs(argv: string[]) {
  const args = { folder: null as string | null, demo: false, fps: null as number | null, policy: null as MirrorPolicyValue | null }
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i]
    if (a === '--demo') args.demo = true
    else if (a === '--fps') args.fps = Number(argv[++i])
    else if (a === '--policy') args.policy = argv[++i] as MirrorPolicyValue
    else if (!a.startsWith('--')) args.folder = a
    else throw new Error(`Không hiểu tham số ${a}`)
  }
  if (args.policy && !['EITHER', 'ANATOMICAL_ONLY', 'MIRROR_ONLY'].includes(args.policy)) throw new Error('--policy không hợp lệ')
  if (args.fps !== null && !(args.fps > 0)) throw new Error('--fps không hợp lệ')
  return args
}

function readRecording(file: string): Recording {
  const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as unknown
  const obj = (Array.isArray(raw) ? { frames: raw } : raw) as Record<string, unknown>
  if (!Array.isArray(obj.frames)) throw new Error('thiếu "frames"')
  const video = (obj.video ?? {}) as Record<string, unknown>
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
  const durationSec = num(video.duration_sec)
  return {
    frames: obj.frames as OpenPoseKeypointFrame[],
    fps: num(obj.fps) ?? num(video.fps),
    durationMs: num(obj.durationMs) ?? (durationSec !== null ? durationSec * 1000 : null),
    recordedVia: obj.recordedVia === 'WEBCAM' ? 'WEBCAM' : 'UPLOAD',
    width: num(obj.width) ?? num(video.width),
    height: num(obj.height) ?? num(video.height),
  }
}

function videoSize(r: Recording) {
  return r.width && r.height ? { width: r.width, height: r.height } : null
}

function resolveFps(r: Recording, fallbackFps: number | null): number | null {
  const resolved = resolveExerciseFps({ recordedVia: r.recordedVia, frameCount: r.frames.length, durationMs: r.durationMs, mlFps: r.fps })
  return resolved?.fps ?? fallbackFps
}

function compile(slug: string, folder: string | null, policy: MirrorPolicyValue | null, fallbackFps: number | null) {
  const file = folder ? path.join(folder, 'template.json') : null
  if (file && fs.existsSync(file)) {
    const rec = readRecording(file)
    const p = policy ?? 'EITHER'
    const result = buildTemplate({ frames: rec.frames, fps: resolveFps(rec, fallbackFps), mirrorPolicy: p, videoSize: videoSize(rec) })
    if (!result.template) throw new Error(`mẫu của ${slug} không dựng được: ${failedGates(result.gates)}`)
    if (!result.ok) console.warn(`  ! mẫu của ${slug} chưa đạt: ${failedGates(result.gates)}`)
    return { template: result.template, policy: p }
  }
  const builtin = BUILTIN_EXERCISES.find((b) => b.slug === slug)
  if (!builtin) throw new Error(`không có template.json và không có bài mẫu tích hợp tên "${slug}"`)
  const result = buildTemplate({ frames: builtin.makeFrames(), fps: builtin.fps, mirrorPolicy: builtin.mirrorPolicy, videoSize: BUILTIN_VIDEO_SIZE })
  if (!result.template) throw new Error(`bài mẫu tích hợp ${slug} không dựng được`)
  return { template: result.template, policy: policy ?? builtin.mirrorPolicy }
}

function failedGates(gates: Array<{ code: string; ok: boolean }>) {
  return gates.filter((g) => !g.ok).map((g) => g.code).join(', ')
}

function categoryOf(file: string): Category | null {
  const name = path.basename(file).toLowerCase()
  return CATEGORIES.find((c) => name.startsWith(c)) ?? null
}

function loadFolder(root: string, fallbackFps: number | null, policy: MirrorPolicyValue | null): ExerciseInput[] {
  const exercises: ExerciseInput[] = []
  for (const slug of fs.readdirSync(root).sort()) {
    const dir = path.join(root, slug)
    if (!fs.statSync(dir).isDirectory()) continue
    const { template, policy: p } = compile(slug, dir, policy, fallbackFps)
    const takes: Take[] = []
    const adults = fs
      .readdirSync(dir)
      .filter((d) => fs.statSync(path.join(dir, d)).isDirectory())
      .sort()
    adults.forEach((adultDir, index) => {
      for (const file of fs.readdirSync(path.join(dir, adultDir)).sort()) {
        if (!file.toLowerCase().endsWith('.json')) continue
        const category = categoryOf(file)
        if (!category) {
          console.warn(`  ! ${slug}, người lớn ${index + 1}: bỏ qua một tệp không bắt đầu bằng good/half/different/still`)
          continue
        }
        try {
          takes.push({ adult: index + 1, category, recording: readRecording(path.join(dir, adultDir, file)) })
        } catch (err) {
          console.warn(`  ! ${slug}, người lớn ${index + 1}: không đọc được một lượt (${(err as Error).message})`)
        }
      }
    })
    exercises.push({ slug, template, policy: p, takes })
  }
  return exercises
}

async function demoExercises(): Promise<ExerciseInput[]> {
  // Synthetic adults only: shows the table format and catches regressions in the script.
  const synthetic = await import('../test/syntheticImitation')
  const { ADULT_BODY } = await import('../src/services/imitation')
  const out: ExerciseInput[] = []
  for (const b of BUILTIN_EXERCISES) {
    const template = synthetic.compiledBuiltin(b.slug)
    const takes: Take[] = []
    for (let adult = 1; adult <= 3; adult += 1) {
      for (let k = 0; k < 2; k += 1) {
        const seed = adult * 10 + k
        const common = { body: ADULT_BODY, pxPerTorso: 150, noisePx: 3, seed }
        const spec = synthetic.getBuiltinSpec(b.slug)
        const make = (category: Category, frames: OpenPoseKeypointFrame[]): Take => ({
          adult,
          category,
          recording: { frames, fps: 30, durationMs: (frames.length / 30) * 1000, recordedVia: 'WEBCAM', width: 960, height: 540 },
        })
        takes.push(make('good', synthetic.childFrames(spec, common)))
        takes.push(make('half', synthetic.childFrames(spec, { ...common, amplitude: 0.5 })))
        takes.push(make('different', synthetic.childFrames(synthetic.getBuiltinSpec(synthetic.DIFFERENT_MOVEMENT[b.slug]), common)))
        takes.push(make('still', synthetic.childFrames(synthetic.getBuiltinSpec('still'), common)))
      }
    }
    out.push({ slug: b.slug, template, policy: b.mirrorPolicy, takes })
  }
  return out
}

function median(values: number[]): number | null {
  if (!values.length) return null
  const s = [...values].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

function evaluate(ex: ExerciseInput, fallbackFps: number | null) {
  const outcomes: Outcome[] = []
  let skipped = 0
  for (const take of ex.takes) {
    const fps = resolveExerciseFps({
      recordedVia: take.recording.recordedVia,
      frameCount: take.recording.frames.length,
      durationMs: take.recording.durationMs,
      mlFps: take.recording.fps,
    })
    const effectiveFps = fps?.fps ?? fallbackFps
    if (!effectiveFps) {
      skipped += 1
      continue
    }
    const r = scoreImitation({
      template: ex.template.features,
      templateHash: ex.template.templateHash,
      templateId: `calibration:${ex.slug}`,
      mirrorPolicy: ex.policy,
      frames: take.recording.frames,
      fps: effectiveFps,
      fpsSource: fps?.source ?? 'duration',
      fpsWarning: fps?.warning ?? false,
      videoSize: videoSize(take.recording),
      practiceMode: 'AFTER_DEMO',
      playbackRate: 1,
      guideOffsetMs: null,
    })
    outcomes.push({ adult: take.adult, category: take.category, overall: r.overall, status: r.status, scoringMs: r.quality.scoringMs })
  }

  const scores = (category: Category) =>
    outcomes
      .filter((o) => o.category === category)
      .filter((o) => o.overall !== null || category === 'good' || category === 'half')
      .map((o) => o.overall ?? 0)
  const insufficient = (category: Category) => outcomes.filter((o) => o.category === category && o.status === 'INSUFFICIENT').length

  const adults = [...new Set(outcomes.map((o) => o.adult))].sort((a, b) => a - b)
  const orderShare = adults.map((adult) => {
    const of = (c: Category) => outcomes.filter((o) => o.adult === adult && o.category === c).map((o) => o.overall ?? 0)
    const [g, h, d] = [of('good'), of('half'), of('different')]
    let ok = 0
    let total = 0
    for (const a of g) for (const b of h) for (const c of d) {
      total += 1
      if (a > b && b > c) ok += 1
    }
    return { adult, share: total ? ok / total : null }
  })

  const med = Object.fromEntries(CATEGORIES.map((c) => [c, median(scores(c))])) as Record<Category, number | null>
  const checks = {
    adults: adults.length >= C1.minAdults,
    good: med.good !== null && med.good >= C1.goodMedianMin,
    different: med.different !== null && med.different <= C1.differentMedianMax,
    still: med.still !== null && med.still <= C1.stillMedianMax,
    order: orderShare.length > 0 && orderShare.every((o) => o.share !== null && o.share >= C1.orderShareMin),
  }
  return {
    slug: ex.slug,
    adults: adults.length,
    takes: outcomes.length,
    skipped,
    med,
    insufficient: Object.fromEntries(CATEGORIES.map((c) => [c, insufficient(c)])) as Record<Category, number>,
    orderShare,
    maxScoringMs: Math.max(0, ...outcomes.map((o) => o.scoringMs)),
    checks,
    pass: Object.values(checks).every(Boolean),
  }
}

const fmt = (v: number | null) => (v === null ? '–' : String(Math.round(v * 10) / 10))
const mark = (ok: boolean) => (ok ? 'đạt' : 'CHƯA ĐẠT')

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (!args.demo && !args.folder) {
    console.error('Cách dùng: npm run exercises:calibrate -- <thư mục> [--fps 30] [--policy EITHER]   (hoặc --demo)')
    process.exit(2)
  }
  if (args.folder && !fs.existsSync(args.folder)) {
    console.error('Không tìm thấy thư mục dữ liệu hiệu chỉnh.')
    process.exit(2)
  }
  const exercises = args.demo ? await demoExercises() : loadFolder(args.folder as string, args.fps, args.policy)
  if (!exercises.length) {
    console.error('Không có bài tập nào trong thư mục (cần <slug>/<người lớn>/<lượt>.json).')
    process.exit(2)
  }
  if (args.demo) console.log('CHẾ ĐỘ DEMO: dữ liệu tổng hợp, chỉ để kiểm tra script, KHÔNG phải kết quả hiệu chỉnh C1.\n')

  console.log('Gate C1 — imitation-v1')
  console.log(
    `Tiêu chí: ≥ ${C1.minAdults} người lớn; trung vị good ≥ ${C1.goodMedianMin}; different ≤ ${C1.differentMedianMax}; still ≤ ${C1.stillMedianMax}; good > half > different ở ≥ ${C1.orderShareMin * 100} phần trăm bộ ba của từng người.\n`,
  )
  let allPass = true
  let worstMs = 0
  for (const ex of exercises) {
    const r = evaluate(ex, args.fps)
    allPass &&= r.pass
    worstMs = Math.max(worstMs, r.maxScoringMs)
    console.log(`[${r.pass ? 'ĐẠT' : 'CHƯA ĐẠT'}] ${r.slug}  (${r.adults} người lớn, ${r.takes} lượt${r.skipped ? `, bỏ qua ${r.skipped} lượt không rõ fps` : ''})`)
    console.log(
      `  trung vị  good ${fmt(r.med.good)} · half ${fmt(r.med.half)} · different ${fmt(r.med.different)} · still ${fmt(r.med.still)}`,
    )
    console.log(
      `  chưa đủ dữ liệu (INSUFFICIENT)  good ${r.insufficient.good} · half ${r.insufficient.half} · different ${r.insufficient.different} · still ${r.insufficient.still}`,
    )
    console.log(
      `  thứ tự good > half > different: ${r.orderShare.map((o) => `người lớn ${o.adult}: ${o.share === null ? 'thiếu lượt' : `${Math.round(o.share * 100)}/100`}`).join(' · ')}`,
    )
    console.log(
      `  kiểm tra: số người ${mark(r.checks.adults)} · good ${mark(r.checks.good)} · different ${mark(r.checks.different)} · still ${mark(r.checks.still)} · thứ tự ${mark(r.checks.order)}`,
    )
    console.log(`  scoringMs lớn nhất: ${fmt(r.maxScoringMs)} ms\n`)
  }
  console.log(`scoringMs lớn nhất toàn bộ: ${fmt(worstMs)} ms`)
  console.log(allPass ? 'KẾT LUẬN: tất cả bài tập đạt C1.' : 'KẾT LUẬN: chưa đạt C1 — không bật EXERCISE_MODE=on; cân nhắc imitation-v2.')
  process.exit(allPass ? 0 : 1)
}

main().catch((err) => {
  console.error(`Lỗi: ${(err as Error).message}`)
  process.exit(2)
})
