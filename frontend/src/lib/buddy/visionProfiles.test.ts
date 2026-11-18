import { beforeEach, describe, expect, it } from 'vitest'
import { enrollmentHint, isEnrollmentComplete, toFaceTemplate, viewsToCapture } from './faceEnrollment'
import {
  clearFamilyFaceSamples,
  faceTemplateViews,
  loadFamilyFaceSamples,
  updateFamilyFaceSamples,
} from './visionProfiles'

const embedding = (seed: number) => Array.from({ length: 128 }, (_, index) => Math.sin(seed + index))
const V1_KEY = 'aimbrace:buddy-face:sface-v1:user%201:child-1'
const V2_KEY = 'aimbrace:buddy-face:sface-v2:user%201:child-1'

beforeEach(() => {
  const store = new Map<string, string>()
  globalThis.localStorage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
    clear: () => store.clear(),
    key: (index: number) => [...store.keys()][index] ?? null,
    get length() {
      return store.size
    },
  }
})

describe('family face storage', () => {
  it('saves and loads several views per person', () => {
    const mother = { front: embedding(1), left: embedding(2), up: embedding(3) }
    expect(updateFamilyFaceSamples('user 1', 'child-1', { mother })).toBe(true)
    const loaded = loadFamilyFaceSamples('user 1', 'child-1')
    expect(loaded).toEqual({ mother })
    expect(faceTemplateViews(loaded.mother!)).toEqual(['front', 'left', 'up'])
  })

  it('reads samples saved by the single-view version as frontal views', () => {
    localStorage.setItem(V1_KEY, JSON.stringify({ child: embedding(4) }))
    expect(loadFamilyFaceSamples('user 1', 'child-1')).toEqual({ child: { front: embedding(4) } })
  })

  it('moves old samples to the new format on the next save', () => {
    localStorage.setItem(V1_KEY, JSON.stringify({ child: embedding(4) }))
    expect(updateFamilyFaceSamples('user 1', 'child-1', { father: { front: embedding(5), right: embedding(6) } })).toBe(true)
    expect(localStorage.getItem(V1_KEY)).toBeNull()
    expect(loadFamilyFaceSamples('user 1', 'child-1')).toEqual({
      child: { front: embedding(4) },
      father: { front: embedding(5), right: embedding(6) },
    })
  })

  it('removes one person, and the whole entry with the last one', () => {
    updateFamilyFaceSamples('user 1', 'child-1', { child: { front: embedding(1) }, mother: { front: embedding(2) } })
    expect(updateFamilyFaceSamples('user 1', 'child-1', { child: null })).toBe(true)
    expect(Object.keys(loadFamilyFaceSamples('user 1', 'child-1'))).toEqual(['mother'])
    expect(updateFamilyFaceSamples('user 1', 'child-1', { mother: null })).toBe(true)
    expect(localStorage.getItem(V2_KEY)).toBeNull()
  })

  it('clears both formats', () => {
    localStorage.setItem(V1_KEY, JSON.stringify({ child: embedding(4) }))
    updateFamilyFaceSamples('user 1', 'child-2', { child: { front: embedding(1) } })
    expect(clearFamilyFaceSamples('user 1', 'child-1')).toBe(true)
    expect(loadFamilyFaceSamples('user 1', 'child-1')).toEqual({})
    expect(Object.keys(loadFamilyFaceSamples('user 1', 'child-2'))).toEqual(['child'])
  })

  it('rejects a template without a valid frontal view and drops malformed extra views', () => {
    expect(updateFamilyFaceSamples('user 1', 'child-1', { mother: { front: [1, 2, 3] } })).toBe(false)
    localStorage.setItem(V2_KEY, JSON.stringify({ mother: { front: embedding(1), left: [1, 2], sideways: embedding(2) }, child: { left: embedding(3) } }))
    expect(loadFamilyFaceSamples('user 1', 'child-1')).toEqual({ mother: { front: embedding(1) } })
  })

  it('survives unreadable storage', () => {
    localStorage.setItem(V2_KEY, '{not json')
    expect(loadFamilyFaceSamples('user 1', 'child-1')).toEqual({})
  })
})

describe('enrolment steps', () => {
  it('captures a view only on its second look in a row, and only once', () => {
    expect(viewsToCapture({}, null)).toEqual([])
    expect(viewsToCapture({}, 'front')).toEqual(['front'])
    expect(viewsToCapture({ front: embedding(1) }, 'front')).toEqual([])
    expect(viewsToCapture({ front: embedding(1) }, 'left')).toEqual(['left'])
  })

  it('asks for the frontal view first, then the sides, then the nods', () => {
    const sample = embedding(1)
    expect(enrollmentHint({})).toContain('Nhìn thẳng')
    expect(enrollmentHint({ front: sample })).toContain('sang một bên')
    expect(enrollmentHint({ front: sample, right: sample })).toContain('bên còn lại')
    expect(enrollmentHint({ front: sample, left: sample, right: sample })).toContain('ngẩng mặt lên, rồi')
    expect(enrollmentHint({ front: sample, left: sample, right: sample, up: sample })).toContain('cúi')
    expect(enrollmentHint({ front: sample, left: sample, right: sample, down: sample })).toContain('ngẩng')
  })

  it('needs the frontal view to produce a template and all five views to finish by itself', () => {
    const sample = embedding(1)
    expect(toFaceTemplate({ left: sample })).toBeNull()
    expect(toFaceTemplate({ front: sample, left: sample })).toEqual({ front: sample, left: sample })
    expect(isEnrollmentComplete({ front: sample, left: sample, right: sample, up: sample })).toBe(false)
    expect(isEnrollmentComplete({ front: sample, left: sample, right: sample, up: sample, down: sample })).toBe(true)
  })
})
