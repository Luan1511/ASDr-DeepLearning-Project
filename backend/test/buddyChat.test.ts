import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { MAX_STEPS, buddyChatInputSchema, buildSystemPrompt, repeatsBuddySpeech, sanitizeBuddyScript } from '../src/lib/buddyScript'

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

  it('accepts a longer history and bounds request size', () => {
    const messages = Array.from({ length: 31 }, (_, i) => ({
      role: i % 2 ? 'buddy' : 'child',
      text: `Lượt ${i + 1}`,
    }))
    assert.equal(buddyChatInputSchema.parse({ messages }).messages.length, 31)
    assert.equal(buddyChatInputSchema.safeParse({ messages: [...messages, ...messages] }).success, false)
  })

  it('includes the age in the system prompt only when known', () => {
    assert.match(buildSystemPrompt(5), /Bạn nhỏ 5 tuổi/)
    assert.doesNotMatch(buildSystemPrompt(), /Bạn nhỏ \d+ tuổi/)
  })

  it('keeps observations tied to each role without inferring a speaker', () => {
    const input = buddyChatInputSchema.parse({
      messages: [{ role: 'child', text: 'Tớ vừa xếp xong cầu.' }],
      vision: { people: [{ role: 'child' }, { role: 'mother', cues: ['smile'] }] },
    })
    assert.match(buildSystemPrompt(undefined, input.vision), /bé \| mẹ, có nét giống đang cười\. Người vừa nói: chưa xác định/)
    assert.doesNotMatch(buildSystemPrompt(), /Ngữ cảnh camera/)
  })

  it('uses an explicit speaker only when the observed role is unique', () => {
    const vision = { people: [{ role: 'mother' as const }], speaker: 'mother' as const }
    assert.match(buildSystemPrompt(undefined, vision), /Người vừa nói: mẹ\./)
    assert.match(buildSystemPrompt(undefined, { ...vision, people: [] }), /Người vừa nói: chưa xác định/)
    assert.match(buildSystemPrompt(undefined, { ...vision, people: [...vision.people, ...vision.people] }), /chưa rõ vai trò \| chưa rõ vai trò\. Người vừa nói: chưa xác định/)
  })

  it('rejects extra identity data and emotion labels in observations', () => {
    const messages = [{ role: 'child', text: 'chào' }]
    for (const person of [
      { role: 'child', name: 'Bé thử' },
      { role: 'child', embedding: [1, 2, 3] },
      { role: 'child', cues: ['sad'] },
    ]) {
      assert.equal(buddyChatInputSchema.safeParse({ messages, vision: { people: [person] } }).success, false)
    }
  })
})

describe('repeatsBuddySpeech', () => {
  const prompt = 'Bạn muốn chơi với thỏ hay với mèo?'
  const reply = sanitizeBuddyScript({ steps: [{ say: `Thỏ có tai dài. ${prompt}` }] })!

  it('flags a recent question even with a new opening', () => {
    assert.equal(repeatsBuddySpeech(reply, [
      { role: 'buddy', text: prompt },
      { role: 'child', text: 'Chơi với thỏ.' },
    ]), true)
  })

  it('allows repeating a question at the child’s request', () => {
    assert.equal(repeatsBuddySpeech(reply, [
      { role: 'buddy', text: prompt },
      { role: 'child', text: 'Bin hỏi lại đi.' },
    ]), false)
  })

  it('flags an echoed child sentence or a repeated line in one reply', () => {
    const text = 'Thỏ nhà mình có đôi tai màu nâu.'
    const echo = sanitizeBuddyScript({ steps: [{ say: `${text} Thỏ hay ăn gì nhỉ?` }] })!
    const duplicate = sanitizeBuddyScript({ steps: [{ say: `${text} ${text}` }] })!
    assert.equal(repeatsBuddySpeech(echo, [{ role: 'child', text }]), true)
    assert.equal(repeatsBuddySpeech(duplicate, []), true)
  })
})
