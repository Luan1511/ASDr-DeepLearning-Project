import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { BANNED_FEEDBACK_WORDS, BUILTIN_EXERCISES, containsBannedWord, type PartId } from '../src/services/imitation'
import {
  CHILD_PART_NAME,
  EXTRA,
  FEEDBACK_CATALOGUE,
  INSUFFICIENT_LEAD,
  OPENING,
  PARENT_PART_NAME,
  buildFeedback,
  fillFeedback,
  limbWords,
  type FeedbackInput,
  type FeedbackPart,
} from '../src/services/imitation/feedback'
import { SCENARIO_NAMES, buildScenario, compiledBuiltin, scoreAttempt, scoreFrames } from './syntheticImitation'

const PART_IDS: PartId[] = ['leftArm', 'rightArm', 'leftLeg', 'rightLeg', 'trunk']

function part(id: PartId, over: Partial<FeedbackPart> = {}): FeedbackPart {
  return {
    part: id,
    active: false,
    visible: true,
    hiddenByChild: false,
    score: 100,
    ratio: null,
    dominant: id === 'trunk' ? 'lean' : id.startsWith('left') ? (id === 'leftArm' ? 'lUpper' : 'lThighLen') : id === 'rightArm' ? 'rUpper' : 'rThighLen',
    worstWindowSec: [1, 2.5],
    ...over,
  }
}

function input(over: Partial<FeedbackInput> & { parts?: FeedbackPart[] } = {}): FeedbackInput {
  return {
    status: 'SCORED',
    reasons: [],
    band: 'VERY_CLOSE',
    parts: PART_IDS.map((p) => part(p)),
    tempoRatio: 1,
    lagSec: null,
    practiceMode: 'AFTER_DEMO',
    mirrorMode: false,
    ...over,
  }
}

function allLines(r: { child: string[]; parent: string[] }) {
  return [...r.child, ...r.parent]
}

describe('banned-word check', () => {
  it('matches whole tokens, NFC-normalised and case-insensitive', () => {
    assert.ok(containsBannedWord('Con làm SAI rồi'))
    assert.ok(containsBannedWord('Kết quả kém'.normalize('NFD')))
    assert.ok(containsBannedWord('có dấu hiệu lạ'))
    assert.ok(containsBannedWord('nguy cơ asd'))
    assert.ok(containsBannedWord('Tự   kỷ'))
    assert.ok(!containsBannedWord('Con làm sài gòn'))
    assert.ok(!containsBannedWord('dấu chấm hiệu lệnh'))
    assert.ok(!containsBannedWord('Saigon'))
    assert.equal(BANNED_FEEDBACK_WORDS.length, 9)
  })
})

describe('feedback catalogue', () => {
  it('no catalogue string, filled with any part name, contains a banned word', () => {
    const fills = PART_IDS.flatMap((p) => [
      { part: CHILD_PART_NAME[p], Part: CHILD_PART_NAME[p].replace(/^./, (c) => c.toUpperCase()), side: 'trái' },
      { part: CHILD_PART_NAME[p], Part: PARENT_PART_NAME[p], side: 'phải' },
    ])
    for (const template of FEEDBACK_CATALOGUE) {
      for (const vars of fills) {
        const text = fillFeedback(template, {
          ...vars,
          limb: limbWords(PART_IDS),
          activeLimb: 'tay',
          t1: '1',
          t2: '3',
          score: '75',
          ratio: '0,8',
          sec: '2,0',
        })
        assert.ok(!containsBannedWord(text), text)
        assert.ok(!/\{\w+\}/.test(text), `unfilled placeholder: ${text}`)
        assert.ok(!text.includes('%'), text)
      }
    }
  })

  it('built-in exercise texts are free of banned words too', () => {
    for (const b of BUILTIN_EXERCISES) {
      for (const text of [b.title, b.description, b.childPrompt]) assert.ok(!containsBannedWord(text), text)
      assert.ok(b.title.length <= 80 && b.description.length <= 500 && b.childPrompt.length <= 120, b.slug)
    }
  })

  it('names groups of parts in the child’s words', () => {
    assert.equal(limbWords(['leftLeg', 'rightLeg']), 'chân')
    assert.equal(limbWords(['leftArm', 'leftLeg']), 'tay và chân')
    assert.equal(limbWords(['leftArm', 'leftLeg', 'trunk']), 'tay, chân và người')
    assert.equal(limbWords([]), 'người')
  })
})

describe('buildFeedback', () => {
  it('opens with the band line and praises the best active part', () => {
    const r = buildFeedback(input({ parts: [part('leftArm', { active: true, score: 95, ratio: 1 }), ...PART_IDS.slice(1).map((p) => part(p))] }))
    assert.deepEqual(r.child, [OPENING.VERY_CLOSE, 'Tay trái làm rất giống bạn Mầm!'])
    assert.ok(r.parent.includes('Tay trái: điểm 95/100, biên độ bằng khoảng 1,0 lần bạn Mầm.'))
    assert.ok(r.parent.includes('Nhịp: gần giống bạn Mầm.'))
  })

  it('picks the tip from the weakest part and its dominant feature', () => {
    const small = buildFeedback(
      input({
        band: 'PROGRESSING',
        parts: [
          part('leftArm', { active: true, score: 50, ratio: 0.5, dominant: 'lUpper' }),
          part('rightArm', { active: true, score: 85, ratio: 1 }),
          ...PART_IDS.slice(2).map((p) => part(p)),
        ],
      }),
    )
    assert.deepEqual(small.child, [OPENING.PROGRESSING, 'Tay phải làm rất giống bạn Mầm!', 'Thử đưa tay trái lên cao hơn nữa nhé!'])
    const knee = buildFeedback(input({ band: 'CLOSE', parts: [...PART_IDS.slice(0, 3).map((p) => part(p)), part('rightLeg', { active: true, score: 60, ratio: 0.5, dominant: 'rThighLen' }), part('trunk')] }))
    assert.ok(knee.child.includes('Thử nâng gối phải cao hơn nhé!'), knee.child.join(' | '))
    const big = buildFeedback(input({ band: 'CLOSE', parts: [part('trunk', { active: true, score: 60, ratio: 2, dominant: 'lean' }), ...PART_IDS.slice(0, 4).map((p) => part(p))] }))
    assert.ok(big.child.includes('Người làm nhẹ nhàng hơn một chút nhé!'), big.child.join(' | '))
    const timing = buildFeedback(input({ band: 'CLOSE', parts: [part('rightArm', { active: true, score: 60, ratio: 1, worstWindowSec: [2.4, 3.9] }), ...PART_IDS.filter((p) => p !== 'rightArm').map((p) => part(p))] }))
    assert.ok(timing.child.includes('Tay phải chưa giống bạn Mầm ở giây 2–4, cùng xem lại bạn Mầm làm nhé!'), timing.child.join(' | '))
  })

  it('adds one extra line in priority order and never more than three lines', () => {
    const base = [part('leftArm', { active: true, score: 60, ratio: 0.5 }), part('rightArm', { active: true, score: 90, ratio: 1 })]
    const legsHidden = buildFeedback(
      input({
        band: 'CLOSE',
        tempoRatio: 2,
        mirrorMode: true,
        parts: [...base, part('leftLeg', { visible: false, hiddenByChild: true, score: null }), part('rightLeg', { visible: false, hiddenByChild: true, score: null }), part('trunk', { score: 40 })],
      }),
    )
    assert.equal(legsHidden.child.length, 3)
    assert.equal(legsHidden.child[2], 'Chưa thấy rõ chân của con, đặt máy xa hơn để thấy cả người nhé.')
    const moving = buildFeedback(input({ band: 'CLOSE', tempoRatio: 2, parts: [...base, part('leftLeg', { score: 40 }), part('rightLeg'), part('trunk')] }))
    assert.equal(moving.child[2], 'Giữ yên chân khi làm động tác tay nhé!')
    const slow = buildFeedback(input({ band: 'CLOSE', tempoRatio: 2, parts: [...base, ...PART_IDS.slice(2).map((p) => part(p))] }))
    assert.equal(slow.child[2], EXTRA.slower)
    const fast = buildFeedback(input({ band: 'CLOSE', tempoRatio: 0.5, parts: [...base, ...PART_IDS.slice(2).map((p) => part(p))] }))
    assert.equal(fast.child[2], EXTRA.faster)
    const late = buildFeedback(input({ band: 'CLOSE', lagSec: 2.4, practiceMode: 'FOLLOW_ALONG', parts: [...base, ...PART_IDS.slice(2).map((p) => part(p))] }))
    assert.equal(late.child[2], EXTRA.late)
    assert.ok(late.parent.includes('Con bắt đầu sau bạn Mầm khoảng 2,4 giây.'))
    const mirror = buildFeedback(input({ mirrorMode: true, parts: [part('leftArm', { active: true, score: 95, ratio: 1 }), ...PART_IDS.slice(1).map((p) => part(p))] }))
    assert.deepEqual(mirror.child, [OPENING.VERY_CLOSE, 'Tay trái làm rất giống bạn Mầm!', EXTRA.mirror])
  })

  it('does not blame the child for a part the demonstration also hides', () => {
    const r = buildFeedback(
      input({ parts: [part('leftArm', { visible: false, hiddenByChild: false, score: null }), part('rightArm', { visible: false, score: null }), part('leftLeg', { active: true, score: 95, ratio: 1 }), part('rightLeg'), part('trunk')] }),
    )
    assert.ok(!allLines(r).some((line) => line.includes('Chưa thấy rõ')), allLines(r).join(' | '))
  })

  it('INSUFFICIENT: Mầm shrugs and gives the matching setup hint', () => {
    const hidden = buildFeedback(
      input({
        status: 'INSUFFICIENT',
        band: null,
        reasons: ['ACTIVE_PART_NOT_VISIBLE'],
        parts: [part('leftLeg', { active: true, visible: false, hiddenByChild: true, score: null }), part('rightLeg', { active: true, visible: false, hiddenByChild: true, score: null }), ...['leftArm', 'rightArm', 'trunk'].map((p) => part(p as PartId))],
      }),
    )
    assert.deepEqual(hidden.child, [INSUFFICIENT_LEAD, 'Chưa thấy rõ chân của con. Đặt máy xa hơn để thấy cả người nhé.'])
    const short = buildFeedback(input({ status: 'INSUFFICIENT', band: null, reasons: ['TOO_FEW_FRAMES', 'VIDEO_TOO_SHORT'] }))
    assert.equal(short.child[1], 'Đoạn quay hơi ngắn. Cùng làm hết bài với bạn Mầm rồi mới dừng nhé.')
    assert.equal(short.parent.length, 2)
  })
})

describe('feedback on scored attempts', () => {
  it('every scenario of every built-in: ≤ 3 child lines, no banned word', () => {
    for (const b of BUILTIN_EXERCISES) {
      const template = compiledBuiltin(b.slug)
      for (const scenario of SCENARIO_NAMES) {
        const r = scoreFrames(template, buildScenario(b.slug, scenario).frames)
        assert.ok(r.feedback.child.length >= 1 && r.feedback.child.length <= 3, `${b.slug}/${scenario}: ${r.feedback.child.join(' | ')}`)
        for (const line of allLines(r.feedback)) assert.ok(!containsBannedWord(line), line)
      }
    }
  })

  it('mirror mode names parts from the child’s side', () => {
    const r = scoreAttempt('gio-tay-chao', { mirror: true })
    assert.equal(r.mode, 'mirror')
    assert.ok(r.feedback.child.includes('Tay trái làm rất giống bạn Mầm!'), r.feedback.child.join(' | '))
    assert.ok(r.feedback.parent.some((line) => line.startsWith('Tay trái: điểm')))
    assert.ok(!allLines(r.feedback).some((line) => line.includes('Tay phải: điểm')))
    const tip = scoreAttempt('gio-tay-chao', { mirror: true, amplitude: 0.6 })
    for (const line of tip.feedback.child.slice(1)) assert.ok(!line.toLowerCase().includes('tay phải'), line)
  })
})
