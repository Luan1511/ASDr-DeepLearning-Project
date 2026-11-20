import { describe, expect, it } from 'vitest'
import { BUDDY_PROP_ART } from '../../components/buddy/BuddyProps'
import { normalizeScript } from './engine'
import { BUDDY_PROPS } from './types'

describe('pictures Bin can show', () => {
  it('has a drawing for every picture in the catalogue', () => {
    expect(Object.keys(BUDDY_PROP_ART).sort()).toEqual([...BUDDY_PROPS].sort())
  })

  it('keeps a known picture from the chat answer and drops unknown ones', () => {
    expect(normalizeScript({ steps: [{ say: 'Mèo kìa!' }], prop: 'cat' })?.prop).toBe('cat')
    expect(normalizeScript({ steps: [{ say: 'Rồng kìa!' }], prop: 'dragon' })?.prop).toBeUndefined()
  })
})
