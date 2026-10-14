import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  BUILTIN_EXERCISES,
  IMITATION_V1,
  resolveExerciseFps,
  scoreImitation,
  subsequenceDtw,
  type ImitationResult,
  type PartId,
} from '../src/services/imitation'
import { cappedDiff } from '../src/services/imitation/features'
import { EXTRA, PARENT_LINE } from '../src/services/imitation/feedback'
import { ADULT_BODY, bump, makeSyntheticFrames } from '../src/services/imitation/syntheticPose'
import { buildTemplate } from '../src/services/imitation'
import {
  CHILD_VIDEO,
  SCENARIO_NAMES,
  buildScenario,
  childFrames,
  compiledBuiltin,
  getBuiltinSpec,
  scoreAttempt,
  scoreFrames,
} from './syntheticImitation'

const SLUGS = BUILTIN_EXERCISES.map((b) => b.slug)
const ARM_SLUGS = ['dang-tay', 'gio-tay-chao', 'vuon-cao']
const PART_IDS: PartId[] = ['leftArm', 'rightArm', 'leftLeg', 'rightLeg', 'trunk']

function activeParts(r: ImitationResult): PartId[] {
  return PART_IDS.filter((p) => r.parts[p].active)
}

function summary(r: ImitationResult): string {
  const parts = PART_IDS.map((p) => `${p}:${r.parts[p].status === 'ok' ? r.parts[p].score : '-'}`).join(' ')
  return `${r.status} overall=${r.overall} mode=${r.mode} rho=${r.tempo.ratio} warnings=${r.quality.warnings} reasons=${r.reasonCodes} ${parts}`
}

function between(value: number | null, lo: number, hi: number, label: string, r?: ImitationResult) {
  assert.ok(value !== null && value >= lo && value <= hi, `${label}: expected ${lo}–${hi}, got ${value}${r ? ` (${summary(r)})` : ''}`)
}

const identical = new Map(SLUGS.map((slug) => [slug, scoreAttempt(slug)]))

describe('imitation-v1 scoring (synthetic cases of spec §7.1)', () => {
  it('1. identical attempt at each built-in: overall ≥ 90 and every active part ≥ 90', () => {
    for (const slug of SLUGS) {
      const r = identical.get(slug) as ImitationResult
      assert.equal(r.status, 'SCORED', `${slug}: ${summary(r)}`)
      between(r.overall, 90, 100, slug, r)
      for (const p of activeParts(r)) between(r.parts[p].score, 90, 100, `${slug} ${p}`, r)
      assert.equal(r.stars, 3)
      assert.equal(r.band, 'VERY_CLOSE')
      assert.ok(r.feedback.child.length >= 1 && r.feedback.child.length <= 3)
    }
  })

  it('2. keypoint noise: 5 px + 10 % drops ≥ 90, 12 px + 15 % drops ≥ 85', () => {
    for (const slug of SLUGS) {
      const light = scoreAttempt(slug, { noisePx: 5, dropRate: 0.1 })
      between(light.overall, 90, 100, `${slug} 5 px`, light)
      const heavy = scoreAttempt(slug, { noisePx: 12, dropRate: 0.15 })
      between(heavy.overall, 85, 100, `${slug} 12 px`, heavy)
    }
  })

  it('3. arms overhead (angles cross ±180°) still score ≥ 90', () => {
    const features = compiledBuiltin('vuon-cao').features
    const values = features.anatomical.values.lUpper.filter((v): v is number => v !== null)
    assert.ok(values.some((v) => v > 170) && values.some((v) => v < -170), 'template crosses ±180°')
    // Naive subtraction would see 358° between 179° and −179°.
    assert.equal(cappedDiff(179, -179), 2)
    const r = scoreAttempt('vuon-cao', { noisePx: 3 })
    between(r.overall, 90, 100, 'overhead', r)
  })

  it('4. gio-tay-chao mirrored with EITHER: ≥ 90, mode mirror, feedback praises the mirror', () => {
    const r = scoreAttempt('gio-tay-chao', { mirror: true })
    between(r.overall, 90, 100, 'mirrored', r)
    assert.equal(r.mode, 'mirror')
    assert.ok(r.feedback.child.some((line) => line.includes('soi gương')), r.feedback.child.join(' | '))
    // Named from the child's side: the child moved the LEFT arm.
    assert.equal(r.parts.leftArm.active, true)
    assert.equal(r.parts.rightArm.active, false)
  })

  it('5. one-sided movement: mirrored under ANATOMICAL_ONLY ≤ 35, anatomical under MIRROR_ONLY ≤ 35', () => {
    const anatomicalOnly = scoreAttempt('gio-tay-chao', { mirror: true, score: { mirrorPolicy: 'ANATOMICAL_ONLY' } })
    between(anatomicalOnly.overall, 0, 35, '5', anatomicalOnly)
    const mirrorOnly = scoreAttempt('gio-tay-chao', { score: { mirrorPolicy: 'MIRROR_ONLY' } })
    between(mirrorOnly.overall, 0, 35, '5b', mirrorOnly)
    const mirroredMirrorOnly = scoreAttempt('gio-tay-chao', { mirror: true, score: { mirrorPolicy: 'MIRROR_ONLY' } })
    between(mirroredMirrorOnly.overall, 90, 100, 'mirror under MIRROR_ONLY', mirroredMirrorOnly)
  })

  it('6. time-stretch 1.5× and 0.75×: ≥ 90 with ρ = 1.5 ± 0.15 and 0.8 ± 0.15', () => {
    for (const slug of SLUGS) {
      const slow = scoreAttempt(slug, { stretch: 1.5 })
      between(slow.overall, 90, 100, `${slug} 1.5×`, slow)
      between(slow.tempo.ratio, 1.35, 1.65, `${slug} ρ 1.5×`, slow)
      const fast = scoreAttempt(slug, { stretch: 0.75 })
      between(fast.overall, 90, 100, `${slug} 0.75×`, fast)
      between(fast.tempo.ratio, 0.65, 0.95, `${slug} ρ 0.75×`, fast)
    }
  })

  it('7. stretch 2.5×: ≥ 80 and a tempo line is given', () => {
    for (const slug of SLUGS) {
      const r = scoreAttempt(slug, { stretch: 2.5 })
      between(r.overall, 80, 100, `${slug} 2.5×`, r)
      assert.ok((r.tempo.score as number) < 1)
      assert.ok(r.feedback.child.includes(EXTRA.slower), `${slug}: ${r.feedback.child.join(' | ')}`)
      assert.ok(r.feedback.parent.some((line) => line.startsWith('Nhịp: con làm chậm hơn')), r.feedback.parent.join(' | '))
    }
  })

  it('8. starting 2 s after the guide (FOLLOW_ALONG, guideOffsetMs 1500): ≥ 90 and lagSec = 2 ± 0.3', () => {
    for (const slug of ['dang-tay', 'gio-tay-chao', 'nghieng-nguoi']) {
      // The guide shows the template segment from 1.5 s; the child starts that segment 2 s later.
      const leadSec = 1.5 + 2 - compiledBuiltin(slug).features.activeStartSec
      const r = scoreAttempt(slug, { leadSec, score: { practiceMode: 'FOLLOW_ALONG', guideOffsetMs: 1500 } })
      between(r.overall, 90, 100, `${slug} late`, r)
      between(r.tempo.lagSec, 1.7, 2.3, `${slug} lag`, r)
      assert.ok(r.feedback.parent.some((line) => line.startsWith('Con bắt đầu sau bạn Mầm')))
    }
  })

  it('9. amplitude 0.8 / 0.5 / 0.25: ≥ 90 / 30–65 / ≤ 20, strictly decreasing, r within ± 0.1', () => {
    const results = [0.8, 0.5, 0.25].map((amplitude) => ({ amplitude, r: scoreAttempt('dang-tay', { amplitude }) }))
    const [a80, a50, a25] = results
    between(a80.r.overall, 90, 100, '0.8', a80.r)
    between(a50.r.overall, 30, 65, '0.5', a50.r)
    between(a25.r.overall, 0, 20, '0.25', a25.r)
    assert.ok((a80.r.overall as number) > (a50.r.overall as number) && (a50.r.overall as number) > (a25.r.overall as number))
    for (const { amplitude, r } of results) {
      for (const p of activeParts(r)) between(r.parts[p].amplitudeRatio, amplitude - 0.1, amplitude + 0.1, `r ${amplitude} ${p}`, r)
    }
    assert.ok(a25.r.quality.warnings.includes('LOW_MOTION'))
  })

  it('10. half-amplitude squat: 40–75', () => {
    const r = scoreAttempt('ngoi-xuong', { amplitude: 0.5 })
    between(r.overall, 40, 75, 'half squat', r)
  })

  it('11. a different movement or standing still scores ≤ 30', () => {
    for (const movement of ['buoc-deu', 'nghieng-nguoi', 'bent-elbow-forward', 'still']) {
      const r = scoreAttempt('dang-tay', { movement })
      assert.equal(r.status, 'SCORED')
      between(r.overall, 0, 30, `dang-tay vs ${movement}`, r)
    }
  })

  it('12. marching template, still child: ≤ 20 with LOW_MOTION', () => {
    const r = scoreAttempt('buoc-deu', { movement: 'still' })
    between(r.overall, 0, 20, 'still marcher', r)
    assert.ok(r.quality.warnings.includes('LOW_MOTION'))
    assert.equal(r.lowMotion, true)
    assert.ok(r.feedback.child.length >= 1)
  })

  it('13. legs out of the picture during an arm exercise: legs not_visible, overall ≥ 90', () => {
    for (const slug of ARM_SLUGS) {
      const r = scoreAttempt(slug, { hideLegs: true })
      assert.equal(r.parts.leftLeg.status, 'not_visible')
      assert.equal(r.parts.rightLeg.status, 'not_visible')
      between(r.overall, 90, 100, `${slug} legs hidden`, r)
      assert.ok(r.feedback.child.some((line) => line.startsWith('Chưa thấy rõ chân')), r.feedback.child.join(' | '))
    }
  })

  it('14. legs out of the picture during the squat: INSUFFICIENT, ACTIVE_PART_NOT_VISIBLE, overall null', () => {
    const r = scoreAttempt('ngoi-xuong', { hideLegs: true })
    assert.equal(r.status, 'INSUFFICIENT')
    assert.deepEqual(r.reasonCodes, ['ACTIVE_PART_NOT_VISIBLE'])
    assert.equal(r.overall, null)
    assert.equal(r.stars, null)
    assert.equal(r.band, null)
    // Visible parts keep their results.
    assert.equal(r.parts.trunk.status, 'ok')
    assert.ok(r.feedback.child[1].includes('chân'))
  })

  it('15. 5 % arm label swaps: within 5 points of the identical attempt, no mirrored-video warning', () => {
    for (const slug of SLUGS) {
      const r = scoreAttempt(slug, { armSwapRate: 0.05 })
      assert.ok(Math.abs((r.overall as number) - ((identical.get(slug) as ImitationResult).overall as number)) <= 5, `${slug}: ${summary(r)}`)
      assert.ok(!r.quality.warnings.includes('MIRRORED_VIDEO'), `${slug}: ${summary(r)}`)
    }
  })

  // nghieng-nguoi is excluded: a ±20° wobble of the trunk is as large as the side bend itself (±18°).
  const WOBBLE_SLUGS = SLUGS.filter((s) => s !== 'nghieng-nguoi')

  it('16. ±10° / ±20° wobble + 8 px noise: ≥ 90 / ≥ 85 (limb wobble and whole-body sway)', () => {
    for (const slug of WOBBLE_SLUGS) {
      for (const seed of [1, 2, 3]) {
        const limb10 = scoreAttempt(slug, { wobbleDeg: 10, noisePx: 8, seed })
        between(limb10.overall, 90, 100, `${slug} limb ±10 s${seed}`, limb10)
        const limb20 = scoreAttempt(slug, { wobbleDeg: 20, noisePx: 8, seed })
        between(limb20.overall, 85, 100, `${slug} limb ±20 s${seed}`, limb20)
        const sway10 = scoreAttempt(slug, { swayDeg: 10, noisePx: 8, seed })
        between(sway10.overall, 90, 100, `${slug} sway ±10 s${seed}`, sway10)
        const sway20 = scoreAttempt(slug, { swayDeg: 20, noisePx: 8, seed })
        between(sway20.overall, 85, 100, `${slug} sway ±20 s${seed}`, sway20)
      }
    }
  })

  it('17. wobble (whole-body sway) + half amplitude: 30–65', () => {
    for (const slug of ['dang-tay', 'ngoi-xuong']) {
      for (const seed of [1, 2, 3]) {
        for (const swayDeg of [10, 20]) {
          const r = scoreAttempt(slug, { swayDeg, amplitude: 0.5, seed })
          between(r.overall, 30, 65, `${slug} sway ±${swayDeg} half s${seed}`, r)
        }
      }
    }
  })

  it('18. child seen in 40 % of frames → TOO_FEW_FRAMES; a 1 s clip → VIDEO_TOO_SHORT', () => {
    const partial = scoreAttempt('dang-tay', { coverage: 0.4 })
    assert.equal(partial.status, 'INSUFFICIENT')
    assert.deepEqual(partial.reasonCodes, ['TOO_FEW_FRAMES'])
    assert.equal(partial.overall, null)
    const short = scoreAttempt('dang-tay', { durationSec: 1 })
    assert.equal(short.status, 'INSUFFICIENT')
    assert.ok(short.reasonCodes.includes('VIDEO_TOO_SHORT'), short.reasonCodes.join(','))
    assert.ok(short.feedback.child.some((line) => line.includes('hơi ngắn')))
    const threeSec = scoreAttempt('dang-tay', { durationSec: 3 })
    assert.deepEqual(threeSec.reasonCodes, ['VIDEO_TOO_SHORT'])
  })

  it('19. a still, more confident adult beside a moving child: within 5 points of identical, no MULTI_PERSON', () => {
    for (const slug of SLUGS) {
      const r = scoreAttempt(slug, { extraPerson: 'still' })
      assert.ok(Math.abs((r.overall as number) - ((identical.get(slug) as ImitationResult).overall as number)) <= 5, `${slug}: ${summary(r)}`)
      assert.ok(!r.quality.warnings.includes('MULTI_PERSON'))
    }
    const busy = scoreAttempt('dang-tay', { extraPerson: 'moving' })
    assert.ok(busy.quality.warnings.includes('MULTI_PERSON'))
  })

  it('20. side-on child: NOT_FACING and overall ≤ 60', () => {
    let scored = 0
    for (const slug of SLUGS) {
      const r = scoreAttempt(slug, { yawDeg: 90 })
      assert.ok(r.quality.warnings.includes('NOT_FACING'), `${slug}: ${summary(r)}`)
      if (r.overall !== null) {
        scored += 1
        between(r.overall, 0, 60, `${slug} side-on`, r)
      }
    }
    assert.ok(scored >= 3, 'the cap is exercised on scored attempts')
  })

  it('21. same input twice gives the same result (except scoringMs)', () => {
    const frames = childFrames(getBuiltinSpec('gio-tay-chao'), { mirror: true, noisePx: 4, seed: 9 })
    const template = compiledBuiltin('gio-tay-chao')
    const strip = (r: ImitationResult) => ({ ...r, quality: { ...r.quality, scoringMs: 0 } })
    assert.deepStrictEqual(strip(scoreFrames(template, frames)), strip(scoreFrames(template, frames)))
  })

  it('22. guide slowed to 0.75×, child follows it: tempo score 1', () => {
    for (const slug of ['dang-tay', 'gio-tay-chao']) {
      const r = scoreAttempt(slug, {
        stretch: 1 / 0.75,
        score: { practiceMode: 'FOLLOW_ALONG', playbackRate: 0.75, guideOffsetMs: 1500 },
      })
      assert.equal(r.tempo.score, 1, summary(r))
      between(r.overall, 90, 100, `${slug} slowed guide`, r)
    }
  })

  it('23. webcam: ML 60 fps vs frames ÷ duration 30 → 30 from the duration, with a warning', () => {
    assert.deepEqual(resolveExerciseFps({ recordedVia: 'WEBCAM', frameCount: 300, durationMs: 10_000, mlFps: 60 }), {
      fps: 30,
      source: 'duration',
      warning: true,
    })
    assert.deepEqual(resolveExerciseFps({ recordedVia: 'WEBCAM', frameCount: 150, durationMs: 10_000, mlFps: 15.5 }), {
      fps: 15,
      source: 'duration',
      warning: false,
    })
    assert.deepEqual(resolveExerciseFps({ recordedVia: 'UPLOAD', frameCount: 300, durationMs: 10_000, mlFps: 29.97 }), {
      fps: 29.97,
      source: 'ml',
      warning: false,
    })
    assert.deepEqual(resolveExerciseFps({ recordedVia: 'UPLOAD', frameCount: 300, durationMs: 10_000, mlFps: 60 }), {
      fps: 60,
      source: 'ml',
      warning: true,
    })
    assert.deepEqual(resolveExerciseFps({ recordedVia: 'UPLOAD', frameCount: 250, durationMs: 10_000, mlFps: null }), {
      fps: 25,
      source: 'duration',
      warning: false,
    })
    assert.equal(resolveExerciseFps({ recordedVia: 'UPLOAD', frameCount: 10, durationMs: 10_000, mlFps: 0 }), null)
    assert.equal(resolveExerciseFps({ recordedVia: 'WEBCAM', frameCount: 10, durationMs: null, mlFps: null }), null)
    assert.equal(resolveExerciseFps({ recordedVia: 'WEBCAM', frameCount: 5000, durationMs: 10_000, mlFps: null }), null)
    // The FPS_UNCERTAIN flag is carried into the result.
    const r = scoreAttempt('dang-tay', { score: { fpsWarning: true } })
    assert.ok(r.quality.warnings.includes('FPS_UNCERTAIN'))
  })

  it('24. empty frames, NaN joints or nobody in the picture: INSUFFICIENT without throwing', () => {
    const template = compiledBuiltin('dang-tay')
    const empty = scoreFrames(template, [])
    assert.equal(empty.status, 'INSUFFICIENT')
    assert.deepEqual(empty.reasonCodes, ['TOO_FEW_FRAMES'])
    const nobody = scoreFrames(
      template,
      Array.from({ length: 300 }, (_, i) => ({ frame_index: i, people: [] })),
    )
    assert.equal(nobody.status, 'INSUFFICIENT')
    const nan = scoreFrames(
      template,
      Array.from({ length: 300 }, (_, i) => ({
        frame_index: i,
        people: [{ person_id: 0, body25: Array.from({ length: 25 }, (_, id) => ({ id, x: Number.NaN, y: Number.NaN, confidence: 0.9 })) }],
      })),
    )
    assert.equal(nan.status, 'INSUFFICIENT')
    const badFps = scoreFrames(template, childFrames(getBuiltinSpec('dang-tay')), { fps: Number.NaN })
    assert.equal(badFps.status, 'INSUFFICIENT')
    for (const r of [empty, nobody, nan, badFps]) {
      assert.equal(r.overall, null)
      assert.deepEqual(Object.keys(r.parts).sort(), [...PART_IDS].sort())
      assert.ok(r.feedback.child.length >= 1)
    }
  })

  it('25. a symmetric movement done as a mirror image: ≥ 90 and mode null', () => {
    for (const slug of ['dang-tay', 'vuon-cao', 'nghieng-nguoi', 'buoc-deu']) {
      const r = scoreAttempt(slug, { mirror: true })
      between(r.overall, 90, 100, `${slug} mirrored`, r)
      assert.equal(r.mode, null)
    }
  })

  it('26. horizontally flipped child video: MIRRORED_VIDEO warning and EITHER ≥ 90', () => {
    for (const slug of SLUGS) {
      const r = scoreAttempt(slug, { flipVideo: true })
      assert.ok(r.quality.warnings.includes('MIRRORED_VIDEO'), `${slug}: ${summary(r)}`)
      between(r.overall, 90, 100, `${slug} flipped`, r)
    }
    assert.ok(!(identical.get('gio-tay-chao') as ImitationResult).quality.warnings.includes('MIRRORED_VIDEO'))
  })

  it('27. worst-case size (template 459 × child 900) is scored; scoringMs is logged', () => {
    // A long demonstration trimmed to exactly 459 samples.
    const longSpec = {
      durationSec: 33,
      pose(t: number) {
        let b = 0
        for (let k = 0; k < 15; k += 1) b += bump(t, 1 + 2 * k, 2)
        return { lUpper: 8 + 82 * b, lFore: 6 + 84 * b, rUpper: 8 + 82 * b, rFore: 6 + 84 * b }
      },
    }
    const frames = makeSyntheticFrames(longSpec, { fps: 25, body: ADULT_BODY })
    const start = 0.6
    const built = buildTemplate({
      frames,
      fps: 25,
      mirrorPolicy: 'EITHER',
      trim: { startSec: start, endSec: start + IMITATION_V1.caps.maxTemplateSamples / IMITATION_V1.hz },
      videoSize: { width: 1920, height: 1080 },
    })
    assert.ok(built.template, JSON.stringify(built.gates))
    assert.equal(built.template.features.n, IMITATION_V1.caps.maxTemplateSamples)
    const child = childFrames(longSpec, { durationSec: 62, leadSec: 1 })
    const timings: number[] = []
    let result: ImitationResult | null = null
    for (let k = 0; k < 3; k += 1) {
      result = scoreFrames(built.template, child)
      timings.push(result.quality.scoringMs)
    }
    const r = result as ImitationResult
    assert.equal(r.status, 'SCORED', summary(r))
    console.log(`[imitation] worst-case scoringMs (459 × 900, EITHER = 2 DTWs): ${timings.join(' / ')} ms`)
  })
})

describe('subsequenceDtw', () => {
  it('finds the matching subsequence and its path', () => {
    const template = [0, 1, 2, 3, 2, 1, 0]
    const child = [5, 5, 0, 1, 2, 3, 2, 1, 0, 5, 5]
    const r = subsequenceDtw(template.length, child.length, (i, j) => Math.abs(template[i] - child[j]))
    assert.equal(r.jStart, 2)
    assert.equal(r.jEnd, 8)
    assert.equal(r.total, 0)
    assert.equal(r.path.length, template.length)
    assert.ok(r.steps.every((s) => s === 0))
  })

  it('allows a child up to 3× slower and 2× faster', () => {
    const template = [0, 4, 8, 4, 0]
    const slow = [0, 0, 0, 4, 4, 4, 8, 8, 8, 4, 4, 4, 0, 0, 0]
    const r = subsequenceDtw(template.length, slow.length, (i, j) => Math.abs(template[i] - slow[j]))
    assert.equal(r.total, 0)
    const fast = [0, 8, 0]
    const f = subsequenceDtw(template.length, fast.length, (i, j) => Math.abs(template[i] - fast[j]))
    assert.ok(Number.isFinite(f.total))
    assert.ok(f.steps.includes(3))
  })

  it('rejects oversized inputs with RangeError', () => {
    assert.throws(() => subsequenceDtw(460, 10, () => 0), RangeError)
    assert.throws(() => subsequenceDtw(10, 901, () => 0), RangeError)
  })
})

describe('buildScenario (contract for the e2e fake ML server)', () => {
  it('returns 30 fps child keypoints for every built-in and scenario', () => {
    for (const slug of SLUGS) {
      for (const scenario of SCENARIO_NAMES) {
        const s = buildScenario(slug, scenario)
        assert.equal(s.fps, 30)
        assert.equal(s.width, CHILD_VIDEO.width)
        assert.equal(s.height, CHILD_VIDEO.height)
        assert.ok(s.frames.length > 0)
        assert.equal(s.durationMs, Math.round((s.frames.length / 30) * 1000))
      }
    }
    assert.throws(() => buildScenario('khong-co', 'identical'))
  })

  it('scenarios score as the e2e tests expect', () => {
    for (const slug of SLUGS) {
      const template = compiledBuiltin(slug)
      const score = (scenario: (typeof SCENARIO_NAMES)[number]) => scoreFrames(template, buildScenario(slug, scenario).frames)
      between(score('identical').overall, 90, 100, `${slug} identical`)
      between(score('mirrored').overall, 90, 100, `${slug} mirrored`)
      between(score('slow_1_5x').overall, 90, 100, `${slug} slow`)
      between(score('still').overall, 0, 20, `${slug} still`)
      between(score('different').overall, 0, 30, `${slug} different`)
      assert.equal(score('too_short').status, 'INSUFFICIENT')
      const hidden = score('legs_hidden')
      if (template.activeParts.some((p) => p === 'leftLeg' || p === 'rightLeg')) {
        assert.deepEqual(hidden.reasonCodes, ['ACTIVE_PART_NOT_VISIBLE'])
      } else {
        between(hidden.overall, 90, 100, `${slug} legs hidden`)
      }
    }
    const half = scoreFrames(compiledBuiltin('dang-tay'), buildScenario('dang-tay', 'half_amplitude').frames)
    between(half.overall, 30, 65, 'dang-tay half')
    // Seeds change the noise but not the outcome.
    const other = scoreFrames(compiledBuiltin('dang-tay'), buildScenario('dang-tay', 'identical', { seed: 42 }).frames)
    between(other.overall, 90, 100, 'seed 42')
  })
})

describe('scoreImitation input handling', () => {
  it('names the policy-allowed modes only and reports mode only for lateralized templates', () => {
    const r = scoreAttempt('dang-tay', { score: { mirrorPolicy: 'MIRROR_ONLY' } })
    assert.equal(r.mode, null)
    assert.ok((r.overall as number) >= 90)
    assert.equal(identical.get('gio-tay-chao')?.mode, 'anatomical')
  })

  it('keeps the parent lines free of numbers shown as percentages', () => {
    for (const r of identical.values()) for (const line of [...r.feedback.parent, ...r.feedback.child]) assert.ok(!line.includes('%'))
    assert.ok(PARENT_LINE.activePart.includes('{score}/100'))
  })

  it('accepts unsorted frames', () => {
    const frames = childFrames(getBuiltinSpec('dang-tay'))
    const shuffled = [...frames].reverse()
    const template = compiledBuiltin('dang-tay')
    assert.equal(scoreFrames(template, shuffled).overall, scoreFrames(template, frames).overall)
  })

  it('truncates very long recordings to the first 900 samples instead of failing', () => {
    const template = compiledBuiltin('dang-tay')
    const frames = childFrames(getBuiltinSpec('dang-tay'), { tailSec: 60 })
    const r = scoreImitation({
      template: template.features,
      templateHash: template.templateHash,
      templateId: 't',
      mirrorPolicy: 'EITHER',
      frames,
      fps: 30,
      fpsSource: 'duration',
      fpsWarning: false,
      videoSize: null,
      practiceMode: 'AFTER_DEMO',
      playbackRate: 1,
      guideOffsetMs: null,
    })
    between(r.overall, 90, 100, 'long recording', r)
  })
})
