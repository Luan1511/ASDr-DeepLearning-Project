import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  childStatsFromProgress,
  exerciseRetryDelayMs,
  progressSeriesKey,
  sessionFingerprint,
  sessionMayHaveMlData,
  starsFor,
  summarizeExerciseProgress,
  summarizeExerciseStats,
  type ProgressSessionRow,
} from '../src/lib/exerciseData'

describe('sessionMayHaveMlData', () => {
  it('is true only while a subject id exists and was not deleted', () => {
    const at = new Date('2026-10-07T00:00:00Z')
    assert.equal(sessionMayHaveMlData({ mlSubjectId: null, mlSubjectDeletedAt: null }), false)
    assert.equal(sessionMayHaveMlData({ mlSubjectId: null, mlSubjectDeletedAt: at }), false)
    assert.equal(sessionMayHaveMlData({ mlSubjectId: 'ex_1', mlSubjectDeletedAt: null }), true)
    assert.equal(sessionMayHaveMlData({ mlSubjectId: 'ex_1', mlSubjectDeletedAt: at }), false)
  })
})

describe('sessionFingerprint', () => {
  const base = { status: 'QUEUED', attempts: 1, mlSubjectId: 'ex_1', mlSubjectDeletedAt: null as Date | null }

  it('changes when the worker may have contacted the ML server again', () => {
    const fp = sessionFingerprint(base)
    assert.equal(sessionFingerprint({ ...base }), fp)
    assert.notEqual(sessionFingerprint({ ...base, attempts: 2 }), fp)
    assert.notEqual(sessionFingerprint({ ...base, mlSubjectId: 'other-id' }), fp)
    assert.notEqual(sessionFingerprint({ ...base, status: 'PROCESSING' }), fp)
    assert.notEqual(sessionFingerprint({ ...base, mlSubjectDeletedAt: new Date('2026-10-07T00:00:00Z') }), fp)
    assert.notEqual(sessionFingerprint({ ...base, mlSubjectId: null }), fp)
  })
})

describe('starsFor / retry delay', () => {
  it('gives every scored attempt at least one star', () => {
    assert.equal(starsFor(100), 3)
    assert.equal(starsFor(80), 3)
    assert.equal(starsFor(79), 2)
    assert.equal(starsFor(60), 2)
    assert.equal(starsFor(59), 1)
    assert.equal(starsFor(0), 1)
    assert.equal(starsFor(null), null)
    assert.equal(starsFor(Number.NaN), null)
  })

  it('backs off 15 s, 30 s, 60 s', () => {
    assert.equal(exerciseRetryDelayMs(1), 15_000)
    assert.equal(exerciseRetryDelayMs(2), 30_000)
    assert.equal(exerciseRetryDelayMs(3), 60_000)
    assert.equal(exerciseRetryDelayMs(0), 15_000)
  })
})

describe('summarizeExerciseProgress', () => {
  const ex1 = { id: 'ex-1', slug: 'dang-tay', title: 'Dang tay', difficulty: 1 }
  const ex2 = { id: 'ex-2', slug: 'buoc-deu', title: 'Bước đều', difficulty: 3 }
  const t1 = { id: 'tpl-1', version: 1 }
  const t2 = { id: 'tpl-2', version: 2 }
  const day = (d: number) => new Date(Date.UTC(2026, 9, d, 8))
  const scored = (overall: number, warnings: string[] = []) => ({
    algorithmVersion: 'imitation-v1',
    status: 'SCORED',
    overall,
    stars: starsFor(overall),
    warnings,
  })
  const insufficient = { algorithmVersion: 'imitation-v1', status: 'INSUFFICIENT', overall: null, stars: null }

  const rows: ProgressSessionRow[] = [
    { id: 's1', status: 'SCORED', createdAt: day(1), exercise: ex1, template: t1, score: scored(55) },
    { id: 's2', status: 'INSUFFICIENT', createdAt: day(2), exercise: ex1, template: t1, score: insufficient },
    { id: 's3', status: 'SCORED', createdAt: day(3), exercise: ex1, template: t1, score: scored(85, ['MULTI_PERSON']) },
    // Template v2 published: a new, separately plotted series.
    { id: 's4', status: 'SCORED', createdAt: day(5), exercise: ex1, template: t2, score: scored(70) },
    { id: 's5', status: 'FAILED', createdAt: day(6), exercise: ex1, template: t2, score: null },
    { id: 's6', status: 'QUEUED', createdAt: day(4), exercise: ex2, template: { id: 'tpl-9', version: 1 }, score: null },
  ]

  it('groups per exercise, most recently practised first', () => {
    const progress = summarizeExerciseProgress(rows)
    assert.deepEqual(
      progress.map((p) => p.exercise.id),
      ['ex-1', 'ex-2'],
    )
  })

  it('splits series by algorithmVersion|templateId in chronological order', () => {
    const [p] = summarizeExerciseProgress(rows)
    assert.deepEqual(
      p.series.map((s) => s.key),
      [progressSeriesKey('imitation-v1', 'tpl-1'), progressSeriesKey('imitation-v1', 'tpl-2')],
    )
    assert.equal(p.series[0].templateVersion, 1)
    assert.equal(p.series[1].templateVersion, 2)
    assert.deepEqual(
      p.series[0].points.map((pt) => [pt.sessionId, pt.status, pt.overall, pt.stars, pt.hasWarnings]),
      [
        ['s1', 'SCORED', 55, 1, false],
        ['s2', 'INSUFFICIENT', null, null, false],
        ['s3', 'SCORED', 85, 3, true],
      ],
    )
    assert.deepEqual(
      p.series[1].points.map((pt) => pt.sessionId),
      ['s4'],
    )
  })

  it('reports attempts, best and last (any status)', () => {
    const [p, q] = summarizeExerciseProgress(rows)
    assert.equal(p.attempts, 5)
    assert.equal(p.scoredAttempts, 3)
    assert.deepEqual(p.best, { overall: 85, stars: 3, at: day(3) })
    assert.deepEqual(p.last, { overall: null, stars: null, status: 'FAILED', at: day(6) })
    assert.deepEqual(p.lastAt, day(6))

    assert.equal(q.attempts, 1)
    assert.equal(q.scoredAttempts, 0)
    assert.equal(q.best, null)
    assert.deepEqual(q.series, [])
    assert.equal(q.last?.status, 'QUEUED')
  })

  it('keeps an INSUFFICIENT last attempt without a number', () => {
    const [p] = summarizeExerciseProgress(rows.slice(0, 2))
    assert.deepEqual(p.last, { overall: null, stars: null, status: 'INSUFFICIENT', at: day(2) })
    assert.deepEqual(p.best, { overall: 55, stars: 1, at: day(1) })
  })

  it('builds the library card numbers', () => {
    const [p] = summarizeExerciseProgress(rows.slice(0, 4))
    assert.deepEqual(childStatsFromProgress(p), {
      attempts: 4,
      scoredAttempts: 3,
      bestStars: 3,
      lastStars: 2,
      lastAt: day(5),
    })
  })

  it('handles no rows', () => {
    assert.deepEqual(summarizeExerciseProgress([]), [])
  })
})

describe('summarizeExerciseStats', () => {
  it('builds the histogram, reason counts and mode split', () => {
    const stats = summarizeExerciseStats(6, [
      { status: 'SCORED', overall: 95, mode: 'mirror', reasonCodes: [] },
      { status: 'SCORED', overall: 100, mode: 'anatomical', reasonCodes: [] },
      { status: 'SCORED', overall: 42, mode: null, reasonCodes: [] },
      { status: 'INSUFFICIENT', overall: null, mode: null, reasonCodes: ['TOO_FEW_FRAMES'] },
      { status: 'INSUFFICIENT', overall: null, mode: null, reasonCodes: ['TOO_FEW_FRAMES', 'VIDEO_TOO_SHORT'] },
    ])
    assert.equal(stats.attempts, 6)
    assert.equal(stats.scored, 3)
    assert.equal(stats.insufficient, 2)
    assert.equal(stats.insufficientRate, 0.4)
    assert.deepEqual(stats.histogram10, [0, 0, 0, 0, 1, 0, 0, 0, 0, 2])
    assert.deepEqual(stats.reasonCounts, { TOO_FEW_FRAMES: 2, VIDEO_TOO_SHORT: 1 })
    assert.deepEqual(stats.modeSplit, { mirror: 1, anatomical: 1, none: 1 })
  })

  it('is all zeros without scores', () => {
    const stats = summarizeExerciseStats(2, [])
    assert.equal(stats.insufficientRate, 0)
    assert.deepEqual(stats.histogram10, new Array(10).fill(0))
  })
})
