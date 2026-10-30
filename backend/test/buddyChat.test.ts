import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { MAX_STEPS, buddyChatInputSchema, buildSystemPrompt, sanitizeBuddyScript } from '../src/lib/buddyScript'

describe('sanitizeBuddyScript', () => {
  it('keeps valid steps and normalises names', () => {
    const script = sanitizeBuddyScript({
      steps: [{ say: '  Xin   chào bạn! ', expression: 'Happy', gesture: 'thumbs-up', ears: 'wiggle', look: 'left' }],
      idle: 'listening',
      suggestions: ['Chào Bin!'],
    })
    assert.deepEqual(script, {
      version: 1,
      steps: [{ say: 'Xin chào bạn!', expression: 'happy', gesture: 'thumbs_up', ears: 'wiggle', look: 'left' }],
      idle: 'listening',
      suggestions: ['Chào Bin!'],
    })
  })

  it('replaces unknown animation names with safe defaults', () => {
    const script = sanitizeBuddyScript({ steps: [{ say: 'A', expression: 'angry', gesture: 'backflip', ears: 'x' }], idle: 7 })
    assert.equal(script?.steps[0].expression, 'happy')
    assert.equal(script?.steps[0].gesture, 'none')
    assert.equal(script?.steps[0].ears, 'none')
    assert.equal(script?.steps[0].look, 'center')
    assert.equal(script?.idle, 'listening')
    assert.deepEqual(script?.suggestions, [])
  })

  it('drops empty steps, caps the count and the text length', () => {
    const long = 'a'.repeat(400)
    const script = sanitizeBuddyScript({ steps: [{ say: '' }, null, ...Array.from({ length: 9 }, () => ({ say: long }))] })
    assert.equal(script?.steps.length, MAX_STEPS)
    assert.ok(script!.steps[0].say.length <= 160)
  })

  it('returns null when nothing is playable', () => {
    assert.equal(sanitizeBuddyScript(null), null)
    assert.equal(sanitizeBuddyScript({ steps: [] }), null)
    assert.equal(sanitizeBuddyScript('hi'), null)
  })
})

describe('buddy chat input', () => {
  it('accepts a short conversation and rejects unknown roles', () => {
    assert.ok(buddyChatInputSchema.safeParse({ messages: [{ role: 'child', text: 'chào' }], childAge: 5 }).success)
    assert.equal(buddyChatInputSchema.safeParse({ messages: [{ role: 'system', text: 'x' }] }).success, false)
    assert.equal(buddyChatInputSchema.safeParse({ messages: [] }).success, false)
  })

  it('mentions the child in the system prompt only when known', () => {
    assert.match(buildSystemPrompt('Na', 5), /Tên bé: Na\. Bé 5 tuổi\./)
    assert.doesNotMatch(buildSystemPrompt(), /Tên bé/)
  })
})
