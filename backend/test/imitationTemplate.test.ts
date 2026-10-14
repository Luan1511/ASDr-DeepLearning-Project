import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import type { OpenPoseKeypointFrame } from '../src/services/openposeService'
import {
  BUILTIN_EXERCISES,
  BUILTIN_SPECS,
  BUILTIN_VIDEO_SIZE,
  buildTemplate,
  canonicalJson,
  templateHash,
  type BuildTemplateResult,
  type TemplateGateCode,
} from '../src/services/imitation'
import { BUILTIN_NEUTRAL_SEC, renderBuiltin } from '../src/services/imitation/builtinExercises'
import { ADULT_BODY, bump, makeSyntheticFrames, type SyntheticExerciseSpec } from '../src/services/imitation/syntheticPose'
import { compiledBuiltin, scoreFrames } from './syntheticImitation'

function build(frames: OpenPoseKeypointFrame[], extra: Partial<Parameters<typeof buildTemplate>[0]> = {}): BuildTemplateResult {
  return buildTemplate({ frames, fps: 25, mirrorPolicy: 'EITHER', videoSize: BUILTIN_VIDEO_SIZE, ...extra })
}

function render(spec: SyntheticExerciseSpec, yawDeg = 0): OpenPoseKeypointFrame[] {
  return makeSyntheticFrames(spec, { fps: 25, body: ADULT_BODY, yawDeg })
}

function failed(result: BuildTemplateResult): TemplateGateCode[] {
  return result.gates.filter((g) => !g.ok).map((g) => g.code)
}

/** Arms out to the side `cycles` times, each `period` seconds, starting at `start`. */
function flaps(start: number, cycles: number, period: number, peak = 82, tail = 1): SyntheticExerciseSpec {
  return {
    durationSec: start + cycles * period + tail,
    pose(t) {
      let b = 0
      for (let k = 0; k < cycles; k += 1) b += bump(t, start + k * period, period)
      return { lUpper: 8 + peak * b, lFore: 6 + peak * b, rUpper: 8 + peak * b, rFore: 6 + peak * b }
    },
  }
}

const builtins = new Map(
  BUILTIN_EXERCISES.map((b) => [
    b.slug,
    buildTemplate({ frames: b.makeFrames(), fps: b.fps, mirrorPolicy: b.mirrorPolicy, videoSize: BUILTIN_VIDEO_SIZE }),
  ]),
)

describe('buildTemplate on the built-ins', () => {
  it('all six built-ins build with every gate passing', () => {
    assert.equal(builtins.size, 6)
    for (const [slug, r] of builtins) {
      assert.ok(r.ok, `${slug}: ${JSON.stringify(r.gates)}`)
      assert.ok(r.template)
      assert.equal(r.gates.length, 7)
      assert.ok(r.template.activeParts.length > 0)
      assert.equal(r.template.features.algorithmVersion, 'imitation-v1')
    }
  })

  it('suggests a trim within ±0.2 s of the true movement boundaries', () => {
    for (const [slug, r] of builtins) {
      const trueEnd = BUILTIN_SPECS[slug].durationSec - BUILTIN_NEUTRAL_SEC
      const trim = r.suggestedTrim as { startSec: number; endSec: number }
      assert.ok(Math.abs(trim.startSec - BUILTIN_NEUTRAL_SEC) <= 0.2, `${slug} start ${trim.startSec}`)
      assert.ok(Math.abs(trim.endSec - trueEnd) <= 0.2, `${slug} end ${trim.endSec} vs ${trueEnd}`)
      assert.equal(r.template?.activeStartSec, trim.startSec)
      assert.equal(r.template?.activeEndSec, trim.endSec)
    }
  })

  it('marks only gio-tay-chao as lateralized', () => {
    for (const [slug, r] of builtins) assert.equal(r.template?.lateralized, slug === 'gio-tay-chao', slug)
    assert.deepEqual(builtins.get('gio-tay-chao')?.template?.activeParts, ['rightArm'])
  })

  it('self-test: identical ≥ 90, mirrored ≥ 90 (EITHER), still ≤ 20', () => {
    for (const [slug, r] of builtins) {
      const st = r.selfTest
      assert.ok(st, slug)
      assert.ok((st.identical as number) >= 90, `${slug} identical ${st.identical}`)
      assert.ok((st.mirrored as number) >= 90, `${slug} mirrored ${st.mirrored}`)
      assert.ok(st.still !== null && st.still <= 20, `${slug} still ${st.still}`)
    }
  })

  it('guide track: 15 joints, root at the origin, median torso 1 ± 0.02, 3 decimals', () => {
    for (const [slug, r] of builtins) {
      const guide = r.template?.guideTrack
      assert.ok(guide)
      assert.equal(guide.hz, 15)
      assert.deepEqual(guide.joints, Array.from({ length: 15 }, (_, j) => j))
      assert.equal(guide.frames.length, r.template?.features.n)
      assert.equal(guide.neutral.length, 30)
      assert.ok(Math.abs(guide.neutral[16] as number) < 0.02 && Math.abs(guide.neutral[17] as number) < 0.02, `${slug} neutral root`)
      const torso: number[] = []
      const rootX: number[] = []
      for (const frame of guide.frames) {
        assert.ok(frame && frame.length === 30)
        for (const v of frame) if (v !== null) assert.equal(Math.round(v * 1000) / 1000, v)
        const [nx, ny, hx, hy] = [frame[2], frame[3], frame[16], frame[17]] as number[]
        torso.push(Math.hypot(nx - hx, ny - hy))
        rootX.push(hx)
      }
      torso.sort((a, b) => a - b)
      const median = torso[Math.floor(torso.length / 2)]
      assert.ok(Math.abs(median - 1) <= 0.02, `${slug} median torso ${median}`)
      assert.ok(rootX.every((x) => Math.abs(x) < 0.02), `${slug} root x stays at 0`)
    }
    // The squat moves the root down; everything else keeps it at the origin.
    const squat = builtins.get('ngoi-xuong')?.template?.guideTrack.frames.map((f) => (f as number[])[17]) as number[]
    assert.ok(Math.min(...squat) < -0.4)
    const wave = builtins.get('gio-tay-chao')?.template?.guideTrack.frames.map((f) => (f as number[])[17]) as number[]
    assert.ok(wave.every((y) => Math.abs(y) < 0.02))
  })

  it('features survive a JSON round trip (as stored in the database)', () => {
    const t = compiledBuiltin('dang-tay')
    const stored = JSON.parse(JSON.stringify(t.features))
    assert.deepStrictEqual(stored, t.features)
    assert.equal(templateHash(stored, 'EITHER'), t.templateHash)
    const frames = renderBuiltin('dang-tay')
    const a = scoreFrames(t, frames, { fps: 25, videoSize: BUILTIN_VIDEO_SIZE })
    const b = scoreFrames({ ...t, features: stored }, frames, { fps: 25, videoSize: BUILTIN_VIDEO_SIZE })
    assert.equal(a.overall, b.overall)
  })
})

describe('templateHash', () => {
  it('is stable across runs and changes with the policy or the trim', () => {
    const frames = renderBuiltin('dang-tay')
    const first = build(frames)
    const second = build(renderBuiltin('dang-tay'))
    assert.equal(first.template?.templateHash, second.template?.templateHash)
    assert.match(first.template?.templateHash as string, /^[0-9a-f]{64}$/)
    const features = first.template?.features as NonNullable<BuildTemplateResult['template']>['features']
    assert.equal(templateHash(features, 'EITHER'), first.template?.templateHash)
    assert.notEqual(templateHash(features, 'ANATOMICAL_ONLY'), first.template?.templateHash)
    const policy = build(frames, { mirrorPolicy: 'MIRROR_ONLY' })
    assert.notEqual(policy.template?.templateHash, first.template?.templateHash)
    const trimmed = build(frames, { trim: { startSec: 1.2, endSec: 6.8 } })
    assert.ok(trimmed.template)
    assert.notEqual(trimmed.template.templateHash, first.template?.templateHash)
    assert.equal(trimmed.template.activeStartSec, 1.2)
    assert.equal(trimmed.template.activeEndSec, 6.8)
  })

  it('canonical JSON sorts keys and rounds numbers to 4 decimals', () => {
    assert.equal(canonicalJson({ b: 1.234567, a: [0.00001, -0.00001, null], c: { z: 1, y: 2 } }), '{"a":[0,0,null],"b":1.2346,"c":{"y":2,"z":1}}')
  })
})

describe('template quality gates', () => {
  it('TEMPLATE_FPS_REQUIRED stops the build when the frame rate is unknown', () => {
    const r = build(renderBuiltin('dang-tay'), { fps: null })
    assert.equal(r.ok, false)
    assert.deepEqual(failed(r), ['TEMPLATE_FPS_REQUIRED'])
    assert.equal(r.gates.length, 1)
    assert.equal(r.template, null)
    assert.equal(r.suggestedTrim, null)
    assert.deepEqual(failed(build(renderBuiltin('dang-tay'), { fps: 400 })), ['TEMPLATE_FPS_REQUIRED'])
  })

  it('TEMPLATE_NO_NEUTRAL_START: movement from the first frame', () => {
    const r = build(render(flaps(0, 3, 2)))
    assert.deepEqual(failed(r), ['TEMPLATE_NO_NEUTRAL_START'])
  })

  it('TEMPLATE_ACTIVE_DURATION: 1 s of activity', () => {
    const r = build(render(flaps(1, 1, 1)))
    assert.deepEqual(failed(r), ['TEMPLATE_ACTIVE_DURATION'])
    assert.ok((r.template?.durationSec as number) < 2)
  })

  it('TEMPLATE_ACTIVE_DURATION: 35 s of activity (too long to score, no template)', () => {
    const r = build(render(flaps(1, 14, 2.5)))
    assert.deepEqual(failed(r), ['TEMPLATE_ACTIVE_DURATION'])
    assert.equal(r.template, null)
    assert.ok(r.suggestedTrim && r.suggestedTrim.endSec - r.suggestedTrim.startSec > 30)
  })

  it('TEMPLATE_NO_ACTIVE_PART: arms move only 10°', () => {
    const r = build(render(flaps(1, 3, 2, 10)))
    assert.ok(failed(r).includes('TEMPLATE_NO_ACTIVE_PART'), JSON.stringify(r.gates))
    assert.deepEqual(r.template?.activeParts, [])
  })

  it('TEMPLATE_PART_NOT_VISIBLE: the left forearm is hidden for 2 s', () => {
    const frames = renderBuiltin('dang-tay').map((f, i) => ({
      frame_index: f.frame_index,
      people: f.people.map((p) => ({
        ...p,
        body25: p.body25.map((j) => (i >= 75 && i < 125 && (j.id === 6 || j.id === 7) ? { ...j, x: 0, y: 0, confidence: 0 } : j)),
      })),
    }))
    const r = build(frames)
    assert.deepEqual(failed(r), ['TEMPLATE_PART_NOT_VISIBLE'])
    assert.ok(r.template?.activeParts.includes('leftArm'))
  })

  it('TEMPLATE_NOT_FACING: demonstrator filmed side-on', () => {
    const r = build(render(BUILTIN_SPECS['gio-tay-chao'], 90))
    assert.ok(failed(r).includes('TEMPLATE_NOT_FACING'), JSON.stringify(r.gates))
  })

  it('TEMPLATE_PERSON_COVERAGE: demonstrator missing in a quarter of the frames', () => {
    const frames = renderBuiltin('dang-tay').map((f, i) => (i % 4 === 0 ? { frame_index: f.frame_index, people: [] } : f))
    const r = build(frames)
    assert.ok(failed(r).includes('TEMPLATE_PERSON_COVERAGE'), JSON.stringify(r.gates))
  })

  it('no person at all: coverage gate fails and nothing is built', () => {
    const r = build(Array.from({ length: 100 }, (_, i) => ({ frame_index: i, people: [] })))
    assert.equal(r.ok, false)
    assert.ok(failed(r).includes('TEMPLATE_PERSON_COVERAGE'))
    assert.equal(r.template, null)
  })
})
