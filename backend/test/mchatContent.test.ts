import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'fs'
import os from 'os'
import path from 'path'
import type { QuestionnaireResponse } from '@prisma/client'
import {
  DEFAULT_CONTENT_PATH,
  TEXT_MAX_LENGTH,
  buildContentTemplate,
  clearContentCache,
  getContentStatus,
  getReadyContent,
  getStage1Content,
  resolveContentPath,
  storedContentVersion,
  validateContent,
  type McHatContentFile,
} from '../src/lib/questionnaires/mchatContent'
import { structureHash } from '../src/lib/questionnaires/mchatRfStructure'
import {
  StepMismatchError,
  applyFollowUpAnswer,
  followUpProgress,
  initFollowUpAnswers,
  type FollowUpAnswers,
  type StepAnswer,
} from '../src/lib/questionnaires/followUpEngine'
import * as copy from '../src/lib/questionnaires/copy'
import { MCHAT_RF } from '../src/lib/questionnaires/mchatRf'
import { buildQuestionnaireConsentStatement } from '../src/lib/consent'
import {
  serializeFollowUpState,
  serializeQuestionnaireContent,
  serializeQuestionnaireResponse,
  toStructureAnswer,
  type StepView,
} from '../src/lib/questionnaireSerializers'

/** Synthetic placeholder texts: "[<key path>]". No instrument wording anywhere. */
function fillPlaceholders(value: unknown, at = ''): unknown {
  if (typeof value === 'string') return value === '' ? `[${at}]` : value
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, fillPlaceholders(v, at ? `${at}.${k}` : k)]))
  }
  return value
}

/** The content's own copyright line: the authors' line plus a synthetic credit. */
const CONTENT_COPYRIGHT = `${MCHAT_RF.copyright}. [copyrightNotice]`

function placeholderContent(): McHatContentFile {
  const filled = fillPlaceholders(buildContentTemplate()) as McHatContentFile
  return {
    ...filled,
    contentVersion: 'test-placeholder',
    licenseRef: 'test-only',
    translationSource: 'synthetic',
    locale: 'vi',
    copyrightNotice: CONTENT_COPYRIGHT,
  }
}

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T

/** Placeholders for stage 1 and its metadata; every Follow-Up text (and the Follow-Up-only ui labels) left empty. */
function stage1OnlyContent(): McHatContentFile {
  const content = placeholderContent()
  const blank = buildContentTemplate()
  content.followUp = blank.followUp
  for (const key of ['yes', 'no', 'maybe', 'maybePrompt', 'mostOftenPrompt', 'otherDescribe', 'followUpInstructions'] as const) {
    content.ui[key] = ''
  }
  return content
}

describe('content template', () => {
  it('has every key with empty texts and the structure metadata', () => {
    const t = buildContentTemplate()
    assert.equal(t.instrument, 'MCHAT_RF')
    assert.equal(t.structureVersion, 'mchat-rf-2025-03')
    assert.equal(t.structureHash, structureHash())
    assert.deepEqual(Object.keys(t.stage1), Array.from({ length: 20 }, (_, i) => String(i + 1)))
    assert.deepEqual(Object.keys(t.followUp), Array.from({ length: 20 }, (_, i) => String(i + 1)))
    assert.deepEqual(Object.keys(t.followUp['1'].nodes), ['prompt', 'cl', 'mo'])
    assert.deepEqual(Object.keys(t.followUp['1'].nodes.cl), ['stem', 'examples'])
    assert.deepEqual(Object.keys(t.followUp['2'].supplementary!), ['s1', 's2'])
    assert.deepEqual(t.followUp['7'].preambles, { after6: '' })
    assert.equal(t.followUp['1'].supplementary, undefined)
    assert.equal(t.followUp['1'].preambles, undefined)
  })

  it('validates as invalid (empty texts) with zero structural errors', () => {
    const v = validateContent(buildContentTemplate())
    assert.equal(v.ok, false)
    assert.equal(v.structuralErrorCount, 0)
    assert.ok(v.emptyCount > 200, String(v.emptyCount))
    for (const e of v.errors) assert.match(e, /: empty$|^… \d+ more empty texts$/)
  })

  it('is valid once every text is filled with placeholders', () => {
    const v = validateContent(placeholderContent())
    assert.deepEqual(v.errors, [])
    assert.equal(v.ok, true)
    assert.equal(v.stage1Ok, true)
  })

  it('stage 1 is usable while only Follow-Up texts are empty', () => {
    const v = validateContent(stage1OnlyContent())
    assert.equal(v.ok, false)
    assert.equal(v.structuralErrorCount, 0)
    assert.equal(v.stage1Ok, true)
    assert.equal(validateContent(buildContentTemplate()).stage1Ok, false)
  })

  it('stage 1 still needs every item, the instructions and the metadata', () => {
    const breakers: Array<[string, (c: McHatContentFile) => void]> = [
      ['an item text', (c) => (c.stage1['7'].text = '')],
      ['examples of an item that has them', (c) => (c.stage1['1'].examples = '')],
      ['the stage-1 instructions', (c) => (c.ui.stage1Instructions = '')],
      ['licenseRef', (c) => (c.licenseRef = '')],
      ['copyrightNotice', (c) => (c.copyrightNotice = '')],
      ['a structural error', (c) => (c.structureHash = 'ffffffffffffffff')],
    ]
    for (const [what, breakIt] of breakers) {
      const c = stage1OnlyContent()
      breakIt(c)
      assert.equal(validateContent(c).stage1Ok, false, what)
    }
    const c = stage1OnlyContent()
    c.stage1['13'].examples = '' // printed without examples
    assert.equal(validateContent(c).stage1Ok, true)
  })

  it('the committed template file is up to date and holds no text', () => {
    const file = path.resolve(__dirname, '..', 'content', 'mchat-rf.template.json')
    const onDisk = JSON.parse(fs.readFileSync(file, 'utf8'))
    assert.deepEqual(onDisk, buildContentTemplate(), 'run the template script again')
    const strings: string[] = []
    const collect = (v: unknown) => {
      if (typeof v === 'string') strings.push(v)
      else if (v && typeof v === 'object') Object.values(v).forEach(collect)
    }
    collect(onDisk)
    assert.deepEqual(strings.filter((s) => s !== '').sort(), ['MCHAT_RF', 'mchat-rf-2025-03', structureHash(), 'vi'].sort())
  })
})

describe('validateContent', () => {
  it('reports missing, unexpected and mistyped keys by path', () => {
    const c = clone(placeholderContent()) as unknown as Record<string, any>
    delete c.followUp['3'].nodes.cl.examples.p11o
    c.followUp['3'].nodes.cl.examples.p12 = '[extra]'
    c.followUp['1'].supplementary = {}
    c.stage1['4'].text = 4
    c.ui = []
    const v = validateContent(c)
    assert.equal(v.ok, false)
    assert.ok(v.errors.includes('followUp.3.nodes.cl.examples.p11o: missing'))
    assert.ok(v.errors.includes('followUp.3.nodes.cl.examples.p12: unexpected key'))
    assert.ok(v.errors.includes('followUp.1.supplementary: unexpected key'))
    assert.ok(v.errors.includes('stage1.4.text: must be a string'))
    assert.ok(v.errors.includes('ui: must be an object'))
    assert.ok(v.structuralErrorCount >= 5)
    assert.equal(validateContent(null).ok, false)
    assert.equal(validateContent([]).ok, false)
  })

  it('requires non-empty texts (after trim) and metadata', () => {
    const c = clone(placeholderContent())
    c.followUp['14'].nodes.f2 = { text: '   ' }
    c.licenseRef = ''
    const v = validateContent(c)
    assert.deepEqual(v.errors, ['licenseRef: empty', 'followUp.14.nodes.f2.text: empty'])
    assert.equal(v.structuralErrorCount, 0)
  })

  it('a prompt note may stay empty (not every official page has one); the key is still required', () => {
    const c = clone(placeholderContent()) as unknown as Record<string, any>
    for (const item of ['1', '8', '12', '14', '15']) c.followUp[item].nodes.prompt.note = ''
    c.followUp['6'].nodes.prompt.note = '   '
    assert.deepEqual(validateContent(c).errors, [])
    assert.equal(validateContent(c).ok, true)
    delete c.followUp['1'].nodes.prompt.note
    assert.deepEqual(validateContent(c).errors, ['followUp.1.nodes.prompt.note: missing'])
    // The prompt text itself stays required.
    const t = clone(placeholderContent())
    ;(t.followUp['3'].nodes.prompt as { text: string }).text = ''
    assert.deepEqual(validateContent(t).errors, ['followUp.3.nodes.prompt.text: empty'])
  })

  it("copyrightNotice must carry the authors' line, not only a translation credit", () => {
    const v = validateContent({ ...placeholderContent(), copyrightNotice: 'Bản dịch: [translator credit]' })
    assert.equal(v.ok, false)
    assert.equal(v.structuralErrorCount, 1)
    assert.match(v.errors[0], /^copyrightNotice: must contain the authors' copyright line/)
    assert.ok(!v.errors[0].includes('translator credit'), 'never echoes the text')
    assert.equal(validateContent({ ...placeholderContent(), copyrightNotice: MCHAT_RF.copyright }).ok, true)
    // Empty: reported as empty only (the template has zero structural errors).
    assert.deepEqual(validateContent({ ...placeholderContent(), copyrightNotice: '' }).errors, ['copyrightNotice: empty'])
  })

  it('requires this structure version and hash, a sane contentVersion and locale', () => {
    const cases: Array<[Partial<McHatContentFile> | Record<string, unknown>, RegExp]> = [
      [{ structureHash: '0123456789abcdef' }, /^structureHash: does not match/],
      [{ structureVersion: 'mchat-rf-2018' as never }, /^structureVersion: must be/],
      [{ instrument: 'OTHER' as never }, /^instrument: must be/],
      [{ contentVersion: 'có dấu cách' }, /^contentVersion:/],
      [{ locale: 'Vietnamese' }, /^locale:/],
      [{ copyrightNotice: '[only a credit]' }, /^copyrightNotice:/],
    ]
    for (const [patch, expected] of cases) {
      const v = validateContent({ ...placeholderContent(), ...patch })
      assert.equal(v.ok, false)
      assert.ok(v.errors.some((e) => expected.test(e)), `${JSON.stringify(patch)} → ${v.errors.join('; ')}`)
    }
  })

  it('never echoes text in errors', () => {
    const c = clone(placeholderContent()) as unknown as Record<string, any>
    c.ui.yes = 'SECRET-TEXT-1'.repeat(TEXT_MAX_LENGTH)
    c.stage1['1'].extra = 'SECRET-TEXT-2'
    c.stage1['2'].text = ['SECRET-TEXT-3']
    const v = validateContent(c)
    assert.equal(v.ok, false)
    assert.ok(!v.errors.join('\n').includes('SECRET'))
  })

  it('caps the error list', () => {
    const c = clone(buildContentTemplate()) as unknown as Record<string, any>
    c.followUp = Object.fromEntries(Object.keys(c.followUp).map((k) => [k, 'x']))
    for (let i = 0; i < 80; i++) c[`extra${i}`] = ''
    const v = validateContent(c)
    assert.ok(v.errors.length <= 50 + 1 + 20 + 1)
    assert.ok(v.errors.some((e) => /more structural errors$/.test(e)))
    assert.ok(v.structuralErrorCount >= 100)
  })
})

describe('content loader', () => {
  let dir = ''
  before(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mchat-content-'))
    clearContentCache()
  })
  after(() => {
    clearContentCache()
    fs.rmSync(dir, { recursive: true, force: true })
  })

  const write = (name: string, body: string, mtime?: Date) => {
    const file = path.join(dir, name)
    fs.writeFileSync(file, body, 'utf8')
    if (mtime) fs.utimesSync(file, mtime, mtime)
    return file
  }

  it('missing file → missing', () => {
    const s = getContentStatus(path.join(dir, 'none.json'))
    assert.equal(s.state, 'missing')
    assert.deepEqual(s.errors, [])
    assert.equal(s.contentVersion, null)
    assert.equal(s.structureHash, structureHash())
    assert.equal(getReadyContent(path.join(dir, 'none.json')), null)
  })

  it('broken JSON → invalid without quoting the file', () => {
    const file = write('broken.json', '{"ui": "SECRET-TEXT-4" ,,, }')
    const s = getContentStatus(file)
    assert.equal(s.state, 'invalid')
    assert.deepEqual(s.errors, ['file is not valid JSON (UTF-8)'])
    assert.ok(!JSON.stringify(s).includes('SECRET'))
    assert.equal(getReadyContent(file), null)
  })

  it('template → invalid with metadata; placeholders → ready; re-read when the file changes', () => {
    const file = path.join(dir, 'mchat-rf.vi.json')
    write('mchat-rf.vi.json', JSON.stringify(buildContentTemplate()), new Date('2026-01-01T00:00:00Z'))
    let s = getContentStatus(file)
    assert.equal(s.state, 'invalid')
    assert.ok(s.errors.length > 0)
    assert.equal(s.path, file)

    const content = placeholderContent()
    // UTF-8 BOM as written by some Windows editors.
    write('mchat-rf.vi.json', `\uFEFF${JSON.stringify(content, null, 2)}`, new Date('2026-01-02T00:00:00Z'))
    s = getContentStatus(file)
    assert.equal(s.state, 'ready')
    assert.deepEqual(s.errors, [])
    assert.equal(s.contentVersion, 'test-placeholder')
    assert.equal(s.licenseRef, 'test-only')
    assert.equal(s.translationSource, 'synthetic')
    assert.deepEqual(getReadyContent(file), content)
    assert.equal(storedContentVersion(content), `test-placeholder@${structureHash()}`)

    write('mchat-rf.vi.json', JSON.stringify({ ...content, structureHash: 'ffffffffffffffff' }), new Date('2026-01-03T00:00:00Z'))
    s = getContentStatus(file)
    assert.equal(s.state, 'invalid')
    assert.equal(getReadyContent(file), null)

    fs.rmSync(file)
    assert.equal(getContentStatus(file).state, 'missing')
  })

  it('stage-1-only file → invalid but stage1Ready; only getStage1Content returns it', () => {
    const file = write('stage1.json', JSON.stringify(stage1OnlyContent()))
    const s = getContentStatus(file)
    assert.equal(s.state, 'invalid')
    assert.equal(s.stage1Ready, true)
    assert.ok(s.errors.length > 0)
    assert.equal(getReadyContent(file), null)
    assert.deepEqual(getStage1Content(file), stage1OnlyContent())

    const full = write('full.json', JSON.stringify(placeholderContent()))
    assert.equal(getContentStatus(full).stage1Ready, true)
    assert.deepEqual(getStage1Content(full), getReadyContent(full))

    const blank = write('blank.json', JSON.stringify(buildContentTemplate()))
    assert.equal(getContentStatus(blank).stage1Ready, false)
    assert.equal(getStage1Content(blank), null)
    assert.equal(getStage1Content(path.join(dir, 'none.json')), null)
  })

  it('a directory is invalid', () => {
    assert.equal(getContentStatus(dir).state, 'invalid')
  })

  it('resolves the configured path against the backend folder', () => {
    const cwd = path.resolve('/srv/backend')
    assert.equal(resolveContentPath(undefined, cwd), path.resolve(cwd, DEFAULT_CONTENT_PATH))
    assert.equal(resolveContentPath('  ', cwd), path.resolve(cwd, DEFAULT_CONTENT_PATH))
    assert.equal(resolveContentPath('content/x.json', cwd), path.resolve(cwd, 'content/x.json'))
    const abs = path.resolve('/tmp/y.json')
    assert.equal(resolveContentPath(abs, cwd), abs)
  })
})

// ---------------------------------------------------------------------------
// In-app DTOs (synthetic placeholders only)
// ---------------------------------------------------------------------------

const now = new Date('2026-10-07T03:00:00.000Z')
function row(patch: Partial<QuestionnaireResponse> = {}): QuestionnaireResponse {
  return {
    id: '00000000-0000-4000-8000-000000000011',
    userId: '00000000-0000-4000-8000-000000000012',
    childId: '00000000-0000-4000-8000-000000000013',
    instrument: 'MCHAT_RF',
    structureVersion: MCHAT_RF.structureVersion,
    scoringVersion: MCHAT_RF.scoringVersion,
    mode: 'IN_APP',
    contentVersion: `test-placeholder@${structureHash()}`,
    respondent: 'MOTHER',
    childAgeMonths: 20,
    answers: {},
    totalScore: 4,
    band: 'MODERATE',
    failedItems: [6, 7, 15, 20],
    followUpStatus: 'PENDING',
    followUpSource: null,
    followUpFailedItems: [],
    followUpFailCount: null,
    followUpAnswers: null,
    followUpCompletedAt: null,
    outcome: 'FOLLOW_UP_NEEDED',
    rescreenAfter: null,
    consentVersion: 'questionnaire-2026-10-07',
    consentStatement: buildQuestionnaireConsentStatement() as unknown as QuestionnaireResponse['consentStatement'],
    consentedAt: now,
    completedAt: now,
    createdAt: now,
    updatedAt: now,
    ...patch,
  }
}

function answer(a: FollowUpAnswers, item: number, step: StepAnswer): FollowUpAnswers {
  return applyFollowUpAnswer(a, { item, ...step })
}

describe('in-app serializers', () => {
  const content = placeholderContent()

  it('content endpoint: stage-1 texts in order, no scoring direction', () => {
    const dto = serializeQuestionnaireContent(content)
    assert.equal(dto.stage1.length, 20)
    assert.deepEqual(dto.stage1[2], { number: 3, text: '[stage1.3.text]', examples: '[stage1.3.examples]' })
    assert.equal(dto.ui.yes, '[ui.yes]')
    assert.equal(dto.contentVersion, 'test-placeholder')
    const json = JSON.stringify(dto)
    for (const key of ['elevatedOn', 'score', 'licenseRef', 'structureHash']) assert.ok(!json.includes(key), key)
  })

  it("always shows the authors' copyright line; the content's own line only when it differs", () => {
    const dto = serializeQuestionnaireContent(content)
    assert.equal(dto.copyrightNotice, MCHAT_RF.copyright)
    assert.equal(dto.contentCopyrightNotice, CONTENT_COPYRIGHT)
    const same = serializeQuestionnaireContent({ ...content, copyrightNotice: ` ${MCHAT_RF.copyright} ` })
    assert.equal(same.copyrightNotice, MCHAT_RF.copyright)
    assert.ok(!('contentCopyrightNotice' in same))
    const state = serializeFollowUpState(row(), initFollowUpAnswers([6]), content)
    assert.equal(state.copyrightNotice, MCHAT_RF.copyright)
    assert.equal(state.contentCopyrightNotice, CONTENT_COPYRIGHT)
  })

  it('follow-up state: item list, current question, preamble after item 6, back flag', () => {
    let a = initFollowUpAnswers([6, 7, 15, 20])
    let dto = serializeFollowUpState(row(), a, content)
    assert.equal(dto.responseId, row().id)
    assert.equal(dto.copyrightNotice, MCHAT_RF.copyright)
    assert.deepEqual(dto.items.map((i) => i.state), ['TODO', 'TODO', 'TODO', 'TODO'])
    assert.equal(dto.response, undefined)
    assert.deepEqual(dto.current, {
      item: 6,
      itemIndex: 0,
      itemCount: 4,
      header: '[followUp.6.header]',
      recap: '[followUp.6.recap]',
      preamble: null,
      canGoBack: false,
      step: { kind: 'PROMPT', node: 'prompt', text: '[followUp.6.nodes.prompt.text]', note: '[followUp.6.nodes.prompt.note]' },
    })

    a = answer(a, 6, { node: 'prompt', value: 'ACK' })
    dto = serializeFollowUpState(row(), a, content)
    assert.deepEqual(dto.current!.step, {
      kind: 'EXAMPLE',
      node: 'cl',
      stem: '[followUp.6.nodes.cl.stem]',
      example: 'e1',
      text: '[followUp.6.nodes.cl.examples.n1]',
      isOther: false,
      index: 0,
      count: 4,
      otherPlaceholder: null,
      allowMaybe: true,
      maybeLabel: '[ui.maybe]',
    })
    assert.equal(dto.current!.canGoBack, true)
    // "Maybe" on an example row → its resolution question, with the position id.
    const exampleMaybe = serializeFollowUpState(row(), a, content, { maybe: { node: 'cl', example: 'n1' } })
    assert.deepEqual(exampleMaybe.current!.step, { kind: 'MAYBE_RESOLVE', node: 'cl', text: '[ui.maybePrompt]', example: 'e1' })
    // A stale "maybe" (other example) leaves the view as is.
    assert.equal(serializeFollowUpState(row(), a, content, { maybe: { node: 'cl', example: 'n2' } }).current!.step.kind, 'EXAMPLE')
    a = answer(a, 6, { node: 'cl', example: 'n1', value: 'YES', maybe: true })
    dto = serializeFollowUpState(row(), a, content)
    assert.equal((dto.current!.step as { example: string }).example, 'e2')
    for (const n of ['n2', 'n3', 'n4']) a = answer(a, 6, { node: 'cl', example: n, value: 'NO' })
    dto = serializeFollowUpState(row(), a, content)
    assert.deepEqual(dto.current!.step, {
      kind: 'YES_NO',
      node: 'q1',
      text: '[followUp.6.nodes.q1.text]',
      allowMaybe: true,
      maybeLabel: '[ui.maybe]',
    })
    // "Maybe" → resolution question, nothing recorded.
    const maybe = serializeFollowUpState(row(), a, content, { maybe: { node: 'q1' } })
    assert.deepEqual(maybe.current!.step, { kind: 'MAYBE_RESOLVE', node: 'q1', text: '[ui.maybePrompt]' })

    a = answer(a, 6, { node: 'q1', value: 'YES', maybe: true }) // item 6 → 0
    dto = serializeFollowUpState(row(), a, content)
    // Item scores stay hidden until the whole Follow-Up is completed.
    assert.deepEqual(dto.items[0], { item: 6, state: 'DONE', score: null, needsReview: false })
    assert.equal(dto.current!.item, 7)
    assert.equal(dto.current!.preamble, '[followUp.7.preambles.after6]')

    for (const step of [
      { node: 'prompt', value: 'ACK' },
      { node: 'cl', example: 'n1', value: 'YES' },
      { node: 'cl', example: 'n2', value: 'NO' },
      { node: 'cl', example: 'n3', value: 'NO' },
      { node: 'cl', example: 'n4', value: 'NO' },
      { node: 'q1', value: 'YES' },
    ]) a = answer(a, 7, step)
    dto = serializeFollowUpState(row(), a, content)
    assert.deepEqual(dto.current!.step, {
      kind: 'CHOICE',
      node: 'q2',
      text: '[followUp.7.nodes.q2.text]',
      options: [
        { option: 'optA', text: '[followUp.7.nodes.q2.options.optA]' },
        { option: 'optBoth', text: '[followUp.7.nodes.q2.options.optBoth]' },
        { option: 'optB', text: '[followUp.7.nodes.q2.options.optB]' },
      ],
    })
    a = answer(a, 7, { node: 'q2', value: 'optB' }) // item 7 → 1

    a = answer(a, 15, { node: 'prompt', value: 'ACK' })
    for (const n of ['n1', 'n2', 'n3', 'n4', 'n5', 'n6']) a = answer(a, 15, { node: 'cnt', example: n, value: n === 'n1' ? 'YES' : 'NO' })
    dto = serializeFollowUpState(row(), a, content)
    const other = dto.current!.step as StepView
    assert.ok(other.kind === 'EXAMPLE')
    assert.equal(other.isOther, true)
    assert.equal(other.example, 'e7')
    assert.equal(other.otherPlaceholder, '[ui.otherDescribe]')
    a = answer(a, 15, { node: 'cnt', example: 'n7o', value: 'YES', otherText: 'mô tả thử nghiệm' }) // → 1, review
    dto = serializeFollowUpState(row(), a, content)
    assert.deepEqual(dto.items[2], { item: 15, state: 'DONE', score: null, needsReview: false }, 'review flag hidden while pending')
    assert.equal(followUpProgress(a).items[2].needsReview, true, 'the state itself stays accurate')
    assert.ok(!JSON.stringify(dto).includes('mô tả thử nghiệm'), 'the description is never output')
  })

  it('views carry position ids only; posted position ids map back to structure ids', () => {
    let a = initFollowUpAnswers([1, 5, 12, 20])
    const seen: string[] = []
    const record = (dto: ReturnType<typeof serializeFollowUpState>) => seen.push(JSON.stringify(dto))
    // Walk a few screens of each list and collect every view.
    a = answer(a, 1, { node: 'prompt', value: 'ACK' })
    for (const e of ['p1', 'p2', 'p3', 'p4', 'f1', 'f2', 'f3']) {
      record(serializeFollowUpState(row({ failedItems: [1, 5, 12, 20] }), a, content))
      a = answer(a, 1, { node: 'cl', example: e, value: e === 'p4' || e === 'f3' ? 'YES' : 'NO' })
    }
    const mo = serializeFollowUpState(row({ failedItems: [1, 5, 12, 20] }), a, content)
    record(mo)
    assert.deepEqual(mo.current!.step, {
      kind: 'MOST_OFTEN',
      node: 'mo',
      text: '[followUp.1.nodes.mo.text]',
      options: [
        { example: 'e4', text: '[followUp.1.nodes.cl.examples.p4]' },
        { example: 'e7', text: '[followUp.1.nodes.cl.examples.f3]' },
      ],
    })
    for (const json of seen) {
      assert.ok(!/"example":"(?!e\d+")/.test(json), `structure id in ${json}`)
      assert.ok(!/"[pfn]\d+o?"/.test(json.replace(/"node":"[^"]*"/g, '')), `structure id in ${json}`)
    }

    // Mapping back: example rows, most-often options; anything else is refused.
    assert.deepEqual(toStructureAnswer({ item: 1, node: 'cl', example: 'e5', value: 'YES' }), { item: 1, node: 'cl', example: 'f1', value: 'YES' })
    assert.deepEqual(toStructureAnswer({ item: 1, node: 'mo', value: 'e7' }), { item: 1, node: 'mo', value: 'f3' })
    assert.deepEqual(toStructureAnswer({ item: 1, node: 'mo', value: 'MAYBE' }), { item: 1, node: 'mo', value: 'MAYBE' })
    assert.deepEqual(toStructureAnswer({ item: 3, node: 'cl', example: 'e11', value: 'YES', otherText: 'x' }), {
      item: 3,
      node: 'cl',
      example: 'p11o',
      value: 'YES',
      otherText: 'x',
    })
    assert.deepEqual(toStructureAnswer({ item: 12, node: 'cnt', example: 'e10', value: 'MAYBE' }), { item: 12, node: 'cnt', example: 'n10o', value: 'MAYBE' })
    assert.deepEqual(toStructureAnswer({ item: 13, node: 'q1', value: 'YES' }), { item: 13, node: 'q1', value: 'YES' })
    assert.deepEqual(toStructureAnswer({ item: 7, node: 'q2', value: 'optB' }), { item: 7, node: 'q2', value: 'optB' })
    for (const bad of [
      { item: 1, node: 'cl', example: 'p1', value: 'YES' }, // a structure id
      { item: 1, node: 'cl', example: 'f1', value: 'YES' },
      { item: 1, node: 'cl', example: 'e8', value: 'YES' }, // past the end
      { item: 1, node: 'cl', example: 'e0', value: 'YES' },
      { item: 1, node: 'cl', example: 'e01', value: 'YES' },
      { item: 1, node: 'mo', value: 'p4' },
      { item: 1, node: 'mo', value: 'e9' },
      { item: 13, node: 'q1', example: 'e1', value: 'YES' }, // not a checklist
    ]) {
      assert.throws(() => toStructureAnswer(bad), StepMismatchError, JSON.stringify(bad))
    }
  })

  it('most often lists the endorsed examples with their texts', () => {
    let a = initFollowUpAnswers([1])
    a = answer(a, 1, { node: 'prompt', value: 'ACK' })
    for (const e of ['p1', 'p2', 'p3', 'p4', 'f1', 'f2', 'f3']) {
      a = answer(a, 1, { node: 'cl', example: e, value: e === 'p3' || e === 'f2' ? 'YES' : 'NO' })
    }
    const dto = serializeFollowUpState(row({ failedItems: [1, 2, 3] }), a, content)
    assert.deepEqual(dto.current!.step, {
      kind: 'MOST_OFTEN',
      node: 'mo',
      text: '[followUp.1.nodes.mo.text]',
      options: [
        { example: 'e3', text: '[followUp.1.nodes.cl.examples.p3]' },
        { example: 'e6', text: '[followUp.1.nodes.cl.examples.f2]' },
      ],
    })
  })

  it('item 2 supplementary questions use the supplementary texts', () => {
    let a = initFollowUpAnswers([2])
    for (const e of ['f1', 'f2']) a = answer(a, 2, { node: 'cl', example: e, value: 'NO' })
    let dto = serializeFollowUpState(row({ failedItems: [2] }), a, content)
    assert.equal(dto.current!.step.kind, 'YES_NO')
    assert.equal((dto.current!.step as { text: string }).text, '[followUp.2.supplementary.s1.text]')
    assert.deepEqual(dto.items[0], { item: 2, state: 'IN_PROGRESS', score: null, needsReview: false })
    a = answer(a, 2, { node: 's1', value: 'YES' })
    dto = serializeFollowUpState(row({ failedItems: [2] }), a, content)
    assert.deepEqual(dto.current!.step, {
      kind: 'CHOICE',
      node: 's2',
      text: '[followUp.2.supplementary.s2.text]',
      options: [
        { option: 'r1', text: '[followUp.2.supplementary.s2.options.r1]' },
        { option: 'r2', text: '[followUp.2.supplementary.s2.options.r2]' },
        { option: 'r3', text: '[followUp.2.supplementary.s2.options.r3]' },
      ],
    })
  })

  it('response DTO: mode, contentVersion and the follow-up summary (numbers only)', () => {
    let a = initFollowUpAnswers([6, 7, 15, 20])
    a = answer(a, 6, { node: 'prompt', value: 'ACK' })
    for (const n of ['n1', 'n2', 'n3', 'n4']) a = answer(a, 6, { node: 'cl', example: n, value: 'NO' }) // → 1
    const pending = serializeQuestionnaireResponse(row({ followUpAnswers: a as never }), { inAppAvailable: true })
    assert.equal(pending.mode, 'IN_APP')
    assert.equal(pending.contentVersion, `test-placeholder@${structureHash()}`)
    assert.deepEqual(pending.followUp, {
      inAppAvailable: true,
      inAppStarted: true,
      itemsDone: 1,
      itemsTotal: 4,
      needsReview: false,
      reviewItems: [],
      itemScores: [],
    })
    assert.ok(pending.actions.body.join(' ').includes('ngay trên ứng dụng'))
    const json = JSON.stringify(pending)
    for (const key of ['followUpAnswers', '"path"', 'answers"', 'otherText']) assert.ok(!json.includes(key), key)

    const unavailable = serializeQuestionnaireResponse(row({ followUpAnswers: a as never }))
    assert.equal(unavailable.followUp.inAppAvailable, false)
    assert.ok(!unavailable.actions.body.join(' ').includes('ngay trên ứng dụng'))

    const fresh = serializeQuestionnaireResponse(row({ mode: 'OFFICIAL_FORM_ENTRY', contentVersion: null }), { inAppAvailable: true })
    assert.equal(fresh.contentVersion, null)
    assert.equal(fresh.followUp.inAppStarted, false)
    assert.equal(fresh.followUp.inAppAvailable, true)

    const completed = row({
      followUpStatus: 'COMPLETED',
      followUpSource: 'IN_APP',
      followUpFailedItems: [6, 15],
      followUpFailCount: 2,
      followUpCompletedAt: now,
      outcome: 'REFER',
    })
    const done = serializeQuestionnaireResponse(completed, { inAppAvailable: true })
    assert.equal(done.followUp.inAppAvailable, false)
    assert.equal(done.followUpSource, 'IN_APP')
    assert.deepEqual(done.followUp.itemScores, [
      { item: 6, score: 1 },
      { item: 7, score: 0 },
      { item: 15, score: 1 },
      { item: 20, score: 0 },
    ])
    const state = serializeFollowUpState(completed, initFollowUpAnswers(completed.failedItems), content)
    assert.equal(state.current, null)
    assert.equal(state.response?.id, completed.id)
    assert.deepEqual(state.items.map((i) => [i.state, i.score]), [['DONE', 1], ['DONE', 0], ['DONE', 1], ['DONE', 0]])

    // Once COMPLETED the review flags are shown too.
    let r = initFollowUpAnswers([20])
    r = answer(r, 20, { node: 'prompt', value: 'ACK' })
    for (const e of ['p1', 'p2', 'p3']) r = answer(r, 20, { node: 'cl', example: e, value: 'NO' })
    r = answer(r, 20, { node: 'cl', example: 'p4o', value: 'YES', otherText: 'x' })
    const reviewed = row({ failedItems: [20], followUpAnswers: r as never, followUpStatus: 'COMPLETED', followUpFailedItems: [20], followUpFailCount: 1, outcome: 'SCREEN_NEGATIVE' })
    assert.deepEqual(serializeFollowUpState(reviewed, r, content).items, [{ item: 20, state: 'DONE', score: 1, needsReview: true }])
    assert.deepEqual(
      serializeFollowUpState({ ...reviewed, followUpStatus: 'PENDING' }, r, content).items,
      [{ item: 20, state: 'DONE', score: null, needsReview: false }],
    )

    const low = serializeQuestionnaireResponse(row({ band: 'LOW', followUpStatus: 'NOT_NEEDED', outcome: 'SCREEN_NEGATIVE', totalScore: 1 }), { inAppAvailable: true })
    assert.deepEqual(low.followUp, { inAppAvailable: false, inAppStarted: false, itemsDone: 0, itemsTotal: 0, needsReview: false, reviewItems: [], itemScores: [] })
  })

  it('reports review items from the stored paths', () => {
    let a = initFollowUpAnswers([20])
    a = answer(a, 20, { node: 'prompt', value: 'ACK' })
    for (const e of ['p1', 'p2', 'p3']) a = answer(a, 20, { node: 'cl', example: e, value: 'NO' })
    a = answer(a, 20, { node: 'cl', example: 'p4o', value: 'YES', otherText: 'x' })
    assert.equal(followUpProgress(a).complete, true)
    const done = { failedItems: [20], followUpAnswers: a as never, followUpFailedItems: [20], followUpFailCount: 1 }
    const dto = serializeQuestionnaireResponse(row({ ...done, followUpStatus: 'COMPLETED', outcome: 'SCREEN_NEGATIVE' }))
    assert.equal(dto.followUp.needsReview, true)
    assert.deepEqual(dto.followUp.reviewItems, [20])
    // Not before COMPLETED (like the per-item scores).
    const pending = serializeQuestionnaireResponse(row({ failedItems: [20], followUpAnswers: a as never }))
    assert.equal(pending.followUp.needsReview, false)
    assert.deepEqual(pending.followUp.reviewItems, [])
  })
})

describe('in-app copy', () => {
  const BANNED = ['chẩn đoán', 'mắc', 'bị tự kỷ', 'dương tính']
  const containsWord = (text: string, word: string) =>
    new RegExp(`(?<![\\p{L}\\p{N}])${word}(?![\\p{L}\\p{N}])`, 'iu').test(text.normalize('NFC'))

  it('is non-diagnostic and has no percentages', () => {
    const strings = [
      copy.CONTENT_UNAVAILABLE_MESSAGE,
      copy.FOLLOW_UP_IN_APP_LABEL,
      ...copy.outcomeCopy('FOLLOW_UP_NEEDED', { afterFollowUp: false, rescreenAfter: null, followUpItems: [3, 9], inAppAvailable: true }).body,
    ]
    for (const text of strings) {
      for (const word of BANNED) assert.ok(!containsWord(text, word), `"${word}" in: ${text}`)
      assert.ok(!text.includes('%'), text)
    }
  })

  it('lists no item numbers when the in-app Follow-Up is offered; the assisted entry keeps them', () => {
    const ctx = { afterFollowUp: false, rescreenAfter: null, followUpItems: [3, 9, 14] }
    const inApp = copy.outcomeCopy('FOLLOW_UP_NEEDED', { ...ctx, inAppAvailable: true }).body.join(' ')
    assert.ok(!/\d/.test(inApp.replace('5–10 phút', '')), inApp)
    assert.ok(inApp.includes('một số câu'))
    assert.ok(copy.outcomeCopy('FOLLOW_UP_NEEDED', ctx).body.join(' ').includes('các câu số 3, 9, 14'))
  })
})
