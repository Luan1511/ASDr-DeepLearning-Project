import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { starsFor, summarizeExerciseProgress, type ProgressSessionRow } from '../src/lib/exerciseData'
import {
  DEFAULT_PERSONALIZATION,
  buildExercisePlan,
  isEmptyPersonalization,
  personalizationSchema,
  serializePersonalization,
  suggestExerciseSettings,
  vietnamWeekStart,
  type Personalization,
  type PlanExercise,
} from '../src/lib/personalization'

const prefs = (over: Partial<Personalization> = {}): Personalization => ({ ...DEFAULT_PERSONALIZATION, ...over })

const EX: Record<string, PlanExercise> = {
  easyArms: { id: 'e1', slug: 'dang-tay', title: 'Dang tay', difficulty: 1, bodyFocus: ['ARMS'] },
  easyArms2: { id: 'e2', slug: 'vuon-cao', title: 'Vươn cao', difficulty: 1, bodyFocus: ['ARMS'] },
  midTrunk: { id: 'e3', slug: 'nghieng-nguoi', title: 'Nghiêng người', difficulty: 2, bodyFocus: ['TRUNK'] },
  midLegs: { id: 'e4', slug: 'ngoi-xuong', title: 'Ngồi xuống', difficulty: 2, bodyFocus: ['LEGS', 'TRUNK'] },
  hardLegs: { id: 'e5', slug: 'buoc-deu', title: 'Bước đều', difficulty: 3, bodyFocus: ['LEGS'] },
}
const LIBRARY = Object.values(EX)

const day = (d: number, hour = 8) => new Date(Date.UTC(2026, 10, d, hour))
let nextId = 0
function attempt(exercise: PlanExercise, at: Date, overall: number | null): ProgressSessionRow {
  nextId += 1
  return {
    id: `s${nextId}`,
    status: overall === null ? 'INSUFFICIENT' : 'SCORED',
    createdAt: at,
    exercise: { id: exercise.id, slug: exercise.slug, title: exercise.title, difficulty: exercise.difficulty },
    template: { id: `tpl-${exercise.id}`, version: 1 },
    score:
      overall === null
        ? { algorithmVersion: 'imitation-v1', status: 'INSUFFICIENT', overall: null, stars: null }
        : { algorithmVersion: 'imitation-v1', status: 'SCORED', overall, stars: starsFor(overall) },
  }
}

function plan(rows: ProgressSessionRow[], over: Partial<Personalization> = {}, now = day(13)) {
  return buildExercisePlan({
    prefs: prefs(over),
    exercises: LIBRARY,
    progress: summarizeExerciseProgress(rows),
    sessionDates: rows.map((r) => r.createdAt),
    now,
  })
}

describe('personalizationSchema', () => {
  it('normalises the whole form and falls back to the defaults', () => {
    const parsed = personalizationSchema.parse({
      nickname: '  Bống  ',
      interests: ['khủng long', ' xe buýt ', 'khủng long'],
      sensory: ['CROWD', 'SOUND'],
      focusAreas: ['LEGS', 'ARMS'],
      calming: '   ',
      weeklyGoal: 3,
    })
    assert.deepEqual(parsed, {
      nickname: 'Bống',
      interests: ['khủng long', 'xe buýt'],
      communication: null,
      // Stored in the canonical order, whatever order the form sent.
      sensory: ['SOUND', 'CROWD'],
      calming: null,
      goals: null,
      focusAreas: ['ARMS', 'LEGS'],
      guideSpeed: 'AUTO',
      practiceMode: 'AUTO',
      liveCoach: null,
      weeklyGoal: 3,
    })
  })

  it('rejects unknown fields, unknown values and oversized text', () => {
    assert.equal(personalizationSchema.safeParse({ diagnosis: 'x' }).success, false)
    assert.equal(personalizationSchema.safeParse({ sensory: ['SMELL'] }).success, false)
    assert.equal(personalizationSchema.safeParse({ guideSpeed: 'FAST' }).success, false)
    assert.equal(personalizationSchema.safeParse({ weeklyGoal: 0 }).success, false)
    assert.equal(personalizationSchema.safeParse({ weeklyGoal: 8 }).success, false)
    assert.equal(personalizationSchema.safeParse({ nickname: 'x'.repeat(41) }).success, false)
    assert.equal(personalizationSchema.safeParse({ interests: Array.from({ length: 13 }, (_, i) => `sở thích ${i}`) }).success, false)
    assert.equal(personalizationSchema.safeParse({ goals: 'x'.repeat(501) }).success, false)
  })
})

describe('serializePersonalization', () => {
  it('gives the defaults when nothing is stored', () => {
    const dto = serializePersonalization(null)
    assert.deepEqual(dto, DEFAULT_PERSONALIZATION)
    assert.equal(isEmptyPersonalization(dto), true)
  })

  it('drops stored values this version does not know', () => {
    const at = new Date('2026-11-17T03:00:00.000Z')
    const dto = serializePersonalization({
      childId: 'c1',
      nickname: 'Bống',
      interests: ['vẽ'],
      communication: 'TELEPATHY',
      sensory: ['SOUND', 'MAGNETISM'],
      calming: null,
      goals: 'Con bắt chước động tác tay',
      focusAreas: ['ARMS', 'WINGS'],
      guideSpeed: 'WARP',
      practiceMode: 'AFTER_DEMO',
      liveCoach: false,
      weeklyGoal: 4,
      createdAt: at,
      updatedAt: at,
    })
    assert.equal(dto.communication, null)
    assert.deepEqual(dto.sensory, ['SOUND'])
    assert.deepEqual(dto.focusAreas, ['ARMS'])
    assert.equal(dto.guideSpeed, 'AUTO')
    assert.equal(dto.practiceMode, 'AFTER_DEMO')
    assert.equal(dto.liveCoach, false)
    assert.equal(isEmptyPersonalization(dto), false)
    assert.deepEqual(dto.updatedAt, at)
  })
})

describe('suggestExerciseSettings', () => {
  const progressOf = (rows: ProgressSessionRow[]) => summarizeExerciseProgress(rows)[0]

  it('keeps the plain defaults for an easy exercise without history', () => {
    assert.deepEqual(suggestExerciseSettings(prefs(), EX.easyArms, undefined), {
      playbackRate: 1,
      practiceMode: null,
      liveCoach: true,
      coachVoice: true,
      reasons: [],
    })
  })

  it('slows the first attempt of a harder exercise and says why', () => {
    const settings = suggestExerciseSettings(prefs(), EX.midTrunk, undefined)
    assert.equal(settings.playbackRate, 0.75)
    assert.deepEqual(settings.reasons.map((r) => r.topic), ['speed'])
    assert.match(settings.reasons[0].text, /Lần đầu con tập một bài ở mức Vừa/)
  })

  it('slows down after two low scores in a row, and goes back to normal after a better one', () => {
    const low = progressOf([attempt(EX.easyArms, day(1), 40), attempt(EX.easyArms, day(2), 55)])
    assert.equal(suggestExerciseSettings(prefs(), EX.easyArms, low).playbackRate, 0.75)
    const better = progressOf([attempt(EX.easyArms, day(1), 40), attempt(EX.easyArms, day(2), 55), attempt(EX.easyArms, day(3), 72)])
    assert.equal(suggestExerciseSettings(prefs(), EX.easyArms, better).playbackRate, 1)
  })

  it("never overrides the parent's explicit choices", () => {
    const low = progressOf([attempt(EX.easyArms, day(1), 30), attempt(EX.easyArms, day(2), 35)])
    const normal = suggestExerciseSettings(prefs({ guideSpeed: 'NORMAL' }), EX.easyArms, low)
    assert.equal(normal.playbackRate, 1)
    const chosen = suggestExerciseSettings(prefs({ guideSpeed: 'SLOW', practiceMode: 'AFTER_DEMO', liveCoach: false }), EX.easyArms, undefined)
    assert.equal(chosen.playbackRate, 0.75)
    assert.equal(chosen.practiceMode, 'AFTER_DEMO')
    assert.equal(chosen.liveCoach, false)
    assert.deepEqual(chosen.reasons.map((r) => r.topic), ['speed', 'mode', 'coach'])
  })

  it('keeps the reminders but mutes the voice for a child who is sensitive to sound', () => {
    const settings = suggestExerciseSettings(prefs({ sensory: ['SOUND'] }), EX.easyArms, undefined)
    assert.equal(settings.liveCoach, true)
    assert.equal(settings.coachVoice, false)
    assert.deepEqual(settings.reasons.map((r) => r.topic), ['coach'])
    assert.match(settings.reasons[0].text, /chỉ nhắc bằng chữ/)
  })
})

describe('vietnamWeekStart', () => {
  it('is Monday 00:00 in Việt Nam (17:00 UTC on Sunday)', () => {
    // Tuesday 2026-11-17 10:00 in Việt Nam
    assert.equal(vietnamWeekStart(new Date('2026-11-17T03:00:00.000Z')).toISOString(), '2026-11-15T17:00:00.000Z')
    // Monday 00:30 in Việt Nam is already the new week...
    assert.equal(vietnamWeekStart(new Date('2026-11-15T17:30:00.000Z')).toISOString(), '2026-11-15T17:00:00.000Z')
    // ...and Sunday 23:30 is still the old one.
    assert.equal(vietnamWeekStart(new Date('2026-11-15T16:30:00.000Z')).toISOString(), '2026-11-08T17:00:00.000Z')
  })
})

describe('buildExercisePlan', () => {
  it('starts a new child with the easy exercises, focus areas first', () => {
    const result = plan([], { focusAreas: ['LEGS'] })
    assert.equal(result.level, 1)
    // Only easy exercises, even though the focus area (legs) has none at that level.
    assert.deepEqual(
      result.recommendations.map((r) => [r.exerciseId, r.kind]),
      [
        ['e1', 'START'],
        ['e2', 'START'],
      ],
    )
    assert.ok(result.recommendations.every((r) => r.reason.length > 0))
  })

  it('starts with the first exercise of a library that has no easy one', () => {
    const result = buildExercisePlan({
      prefs: prefs(),
      exercises: [EX.midTrunk, EX.hardLegs],
      progress: [],
      sessionDates: [],
      now: day(13),
    })
    assert.deepEqual(result.recommendations.map((r) => [r.exerciseId, r.kind]), [['e3', 'START']])
    // A first attempt above the easy level is demonstrated more slowly.
    assert.equal(result.recommendations[0].settings.playbackRate, 0.75)
  })

  it('continues the exercise the child is in the middle of, then offers something new at the same level', () => {
    const result = plan([attempt(EX.easyArms, day(10), 62), attempt(EX.easyArms, day(11), 70)])
    assert.equal(result.level, 1)
    assert.deepEqual(
      result.recommendations.map((r) => [r.exerciseId, r.kind]),
      [
        ['e1', 'CONTINUE'],
        ['e2', 'NEW'],
      ],
    )
    assert.match(result.recommendations[0].reason, /mới tập bài này 2 lần/)
  })

  it('suggests one level up only after three high scores in a row at the current level', () => {
    const two = plan([attempt(EX.easyArms, day(9), 85), attempt(EX.easyArms, day(10), 90)])
    assert.equal(two.recommendations.some((r) => r.kind === 'STEP_UP'), false)

    const three = plan([attempt(EX.easyArms, day(9), 85), attempt(EX.easyArms, day(10), 90), attempt(EX.easyArms2, day(11), 82)], {
      focusAreas: ['LEGS'],
    })
    const stepUp = three.recommendations.find((r) => r.kind === 'STEP_UP')
    // The parent's focus area decides which level-2 exercise comes first.
    assert.equal(stepUp?.exerciseId, 'e4')
    assert.match(stepUp!.reason, /mức Dễ.*mức Vừa/)
    // A first attempt one level up is demonstrated more slowly.
    assert.equal(stepUp!.settings.playbackRate, 0.75)

    const dipped = plan([attempt(EX.easyArms, day(9), 85), attempt(EX.easyArms, day(10), 90), attempt(EX.easyArms2, day(11), 70)])
    assert.equal(dipped.recommendations.some((r) => r.kind === 'STEP_UP'), false)
  })

  it('raises the level once a harder exercise goes comfortably', () => {
    const result = plan([
      attempt(EX.easyArms, day(5), 88),
      attempt(EX.midTrunk, day(9), 64),
      attempt(EX.midTrunk, day(10), 71),
      attempt(EX.midTrunk, day(11), 83),
    ])
    assert.equal(result.level, 2)
    // New suggestions may now come from level 1 and 2, never from level 3.
    const fresh = result.recommendations.filter((r) => r.kind === 'NEW').map((r) => r.exerciseId)
    assert.ok(fresh.length > 0)
    assert.equal(fresh.includes('e5'), false)
  })

  it('offers a slower review when the latest exercise got hard', () => {
    const result = plan([attempt(EX.midTrunk, day(10), 35), attempt(EX.midTrunk, day(11), 44)])
    const [first] = result.recommendations
    assert.deepEqual([first.exerciseId, first.kind], ['e3', 'REVIEW'])
    assert.equal(first.settings.playbackRate, 0.75)
  })

  it('never recommends more than three exercises and never the same one twice', () => {
    const result = plan([attempt(EX.easyArms, day(9), 85), attempt(EX.easyArms, day(10), 90), attempt(EX.easyArms, day(11), 82)])
    assert.ok(result.recommendations.length <= 3)
    assert.equal(new Set(result.recommendations.map((r) => r.exerciseId)).size, result.recommendations.length)
  })

  it('keeps recommending when every exercise at the level was tried', () => {
    const easyOnly = [EX.easyArms, EX.easyArms2]
    const rows = [
      attempt(EX.easyArms, day(8), 90),
      attempt(EX.easyArms, day(9), 91),
      attempt(EX.easyArms, day(10), 92),
      attempt(EX.easyArms2, day(11), 93),
      attempt(EX.easyArms2, day(12), 94),
      attempt(EX.easyArms2, day(12, 9), 95),
    ]
    const result = buildExercisePlan({
      prefs: prefs(),
      exercises: easyOnly,
      progress: summarizeExerciseProgress(rows),
      sessionDates: rows.map((r) => r.createdAt),
      now: day(13),
    })
    // Least recently practised first.
    assert.deepEqual(result.recommendations.map((r) => [r.exerciseId, r.kind]), [
      ['e1', 'CONTINUE'],
      ['e2', 'CONTINUE'],
    ])
  })

  it('counts distinct practice days of the current week in Việt Nam time', () => {
    // "now" is Friday 2026-11-13; the week started Monday 2026-11-09 00:00 (+07).
    const rows = [
      attempt(EX.easyArms, new Date('2026-11-08T16:00:00.000Z'), 70), // Sunday 23:00 +07: last week
      attempt(EX.easyArms, new Date('2026-11-08T18:00:00.000Z'), 70), // Monday 01:00 +07
      attempt(EX.easyArms, new Date('2026-11-09T02:00:00.000Z'), 70), // Monday 09:00 +07 (same day)
      attempt(EX.easyArms, new Date('2026-11-11T10:00:00.000Z'), null), // Wednesday, not scored but practised
    ]
    const result = plan(rows, { weeklyGoal: 3 }, new Date('2026-11-13T05:00:00.000Z'))
    assert.deepEqual(result.weekly, { goal: 3, daysPractised: 2, weekStart: new Date('2026-11-08T17:00:00.000Z') })
  })
})
