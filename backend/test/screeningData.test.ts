import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { RiskLevel, ScreeningStatus } from '@prisma/client'
import { mayHaveMlData, mlSubjectIdFor, resultProvider, summarizeScreenings } from '../src/lib/screeningData'

const real = { rawAiResponse: { provider: 'openpose-stgcn', subjectId: 'video-1' } }
const mock = { rawAiResponse: { provider: 'mock' } }

describe('resultProvider / mlSubjectIdFor', () => {
  it('reads the provider and the ML subject id from rawAiResponse', () => {
    assert.equal(resultProvider(real.rawAiResponse), 'openpose-stgcn')
    assert.equal(resultProvider(null), null)
    assert.equal(resultProvider({ provider: 3 }), null)
    assert.equal(mlSubjectIdFor({ id: 'upload-1', result: real }), 'video-1')
  })

  it('falls back to the upload id', () => {
    assert.equal(mlSubjectIdFor({ id: 'upload-1' }), 'upload-1')
    assert.equal(mlSubjectIdFor({ id: 'upload-1', result: { rawAiResponse: { subjectId: '' } } }), 'upload-1')
    assert.equal(mlSubjectIdFor({ id: 'upload-1', result: { rawAiResponse: null } }), 'upload-1')
  })
})

describe('mayHaveMlData', () => {
  it('is true for model results and false for simulated ones', () => {
    assert.equal(mayHaveMlData({ status: ScreeningStatus.COMPLETED, result: real }), true)
    assert.equal(mayHaveMlData({ status: ScreeningStatus.COMPLETED, result: mock, job: { attempts: 1 } }), false)
  })

  it('depends on whether a job ever reached the ML server', () => {
    assert.equal(mayHaveMlData({ status: ScreeningStatus.PROCESSING, job: { attempts: 0 } }), false)
    assert.equal(mayHaveMlData({ status: ScreeningStatus.FAILED, job: { attempts: 3 } }), true)
    assert.equal(mayHaveMlData({ status: ScreeningStatus.PROCESSING, job: { attempts: 1 } }), true)
  })

  it('treats uploads from before the job queue as processed unless never sent', () => {
    assert.equal(mayHaveMlData({ status: ScreeningStatus.UPLOADED }), false)
    assert.equal(mayHaveMlData({ status: ScreeningStatus.FAILED }), true)
    assert.equal(mayHaveMlData({ status: ScreeningStatus.COMPLETED, job: null, result: null }), true)
  })
})

describe('summarizeScreenings', () => {
  const at = (iso: string) => new Date(iso)

  it('counts screenings per child and keeps the latest result', () => {
    const summaries = summarizeScreenings([
      { childId: 'a', createdAt: at('2026-10-01T00:00:00Z'), result: { riskLevel: RiskLevel.HIGH } },
      { childId: 'a', createdAt: at('2026-10-05T00:00:00Z'), result: { riskLevel: RiskLevel.LOW } },
      { childId: 'a', createdAt: at('2026-10-06T00:00:00Z'), result: null },
      { childId: 'b', createdAt: at('2026-09-01T00:00:00Z'), result: null },
    ])

    assert.deepEqual(summaries.get('a'), {
      screeningCount: 3,
      completedCount: 2,
      lastScreeningAt: at('2026-10-06T00:00:00Z'),
      lastResult: { riskLevel: RiskLevel.LOW, screenedAt: at('2026-10-05T00:00:00Z') },
    })
    assert.deepEqual(summaries.get('b'), {
      screeningCount: 1,
      completedCount: 0,
      lastScreeningAt: at('2026-09-01T00:00:00Z'),
      lastResult: null,
    })
    assert.equal(summaries.get('c'), undefined)
  })

  it('does not depend on the input order', () => {
    const summaries = summarizeScreenings([
      { childId: 'a', createdAt: at('2026-10-05T00:00:00Z'), result: { riskLevel: RiskLevel.MEDIUM } },
      { childId: 'a', createdAt: at('2026-10-01T00:00:00Z'), result: { riskLevel: RiskLevel.HIGH } },
    ])
    assert.equal(summaries.get('a')?.lastResult?.riskLevel, RiskLevel.MEDIUM)
    assert.deepEqual(summaries.get('a')?.lastScreeningAt, at('2026-10-05T00:00:00Z'))
  })
})
