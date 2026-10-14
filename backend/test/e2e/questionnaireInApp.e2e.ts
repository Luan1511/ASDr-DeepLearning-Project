/**
 * M-CHAT-R/F in-app mode end-to-end scenarios (mchat_inapp_spec.md §6 "E2E").
 *
 * The licensed content file is SYNTHETIC: buildContentTemplate() with every
 * empty text replaced by its own key path in brackets (e.g.
 * "[followUp.3.nodes.cl.examples.p2]"), written to a temp folder. No item,
 * example, instruction or Follow-Up wording appears anywhere in this file.
 *
 * Run: npx tsx --test --test-concurrency=1 test/e2e/questionnaireInApp.e2e.ts
 */
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { QUESTIONNAIRE_CONSENT_VERSION } from '../../src/lib/consent'
import { secondBirthday } from '../../src/lib/questionnaires/age'
import { buildContentTemplate } from '../../src/lib/questionnaires/mchatContent'
import { MCHAT_RF } from '../../src/lib/questionnaires/mchatRf'
import { followUpItem, structureHash } from '../../src/lib/questionnaires/mchatRfStructure'
import { BACKEND_PORT, E2eHarness, api, type ApiResponse, type SeededUser } from './harness'

const h = new E2eHarness('questionnaire-inapp')
let parentA: SeededUser
let parentB: SeededUser
let admin: SeededUser
/** Absolute MCHAT_CONTENT_PATH used by most scenarios (it does not exist at first). */
let contentFile = ''
let childId = ''
/** Second birthday of the 20-month child (rescreen date of a negative Follow-Up). */
let rescreenFor20Months = ''

const CONTENT_VERSION = 'e2e-synthetic'
/** The content file's own copyright line: the authors' line plus a synthetic credit. */
const CONTENT_COPYRIGHT = `${MCHAT_RF.copyright}. [copyrightNotice]`
/** A description typed into an "Other" row: stored in the DB only, never output or logged. */
const OTHER_MARKER = 'E2E-OTHER-DESCRIPTION-7f3a'

before(async () => {
  await h.setup()
  parentA = h.users.parentA
  parentB = h.users.parentB
  admin = h.users.admin
  contentFile = path.join(h.root, 'licensed-content', 'mchat-rf.vi.json')
}, { timeout: 300_000 })

after(async () => {
  await h.teardown()
}, { timeout: 120_000 })

function scenario(name: string, fn: () => Promise<void>) {
  test(name, { timeout: 180_000 }, async () => {
    try {
      await fn()
    } catch (error) {
      if (error instanceof Error) error.message += `\n--- backend log tail ---\n${h.backendLog.slice(-25).join('\n')}`
      throw error
    }
  })
}

// ---------------------------------------------------------------------------
// Synthetic content
// ---------------------------------------------------------------------------

/** Every empty string becomes "[<key path>]"; filled metadata (hash, version, locale) is kept. */
function fillPlaceholders(value: unknown, at = ''): unknown {
  if (typeof value === 'string') return value === '' ? `[${at}]` : value
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, fillPlaceholders(v, at ? `${at}.${k}` : k)]))
  }
  return value
}

function syntheticContent(): Record<string, unknown> {
  return {
    ...(fillPlaceholders(buildContentTemplate()) as Record<string, unknown>),
    contentVersion: CONTENT_VERSION,
    licenseRef: 'e2e-no-license-synthetic',
    translationSource: 'e2e-synthetic-placeholders',
    copyrightNotice: CONTENT_COPYRIGHT,
  }
}

/** Writes `json` to `file` and moves its mtime forward so the loader's cache sees a change. */
function writeContent(file: string, json: unknown, bumpSeconds = 0) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, typeof json === 'string' ? json : JSON.stringify(json, null, 2))
  const t = new Date(Date.now() + bumpSeconds * 1000)
  fs.utimesSync(file, t, t)
}

/** Placeholder of a Follow-Up node field (main graph or item 2's supplementary graph). */
function fuText(item: number, node: string, ...rest: string[]) {
  const group = node in followUpItem(item).nodes ? 'nodes' : 'supplementary'
  return `[${['followUp', item, group, node, ...rest].join('.')}]`
}

// ---------------------------------------------------------------------------
// HTTP helpers (every parent-facing body is kept for the privacy checks)
// ---------------------------------------------------------------------------

const seenBodies: string[] = []
/** Responses with a 5xx status other than the expected 503s. */
const serverErrors: string[] = []

async function call(method: string, urlPath: string, opts: Parameters<typeof api>[2] = {}): Promise<ApiResponse> {
  const res = await api(method, urlPath, opts)
  seenBodies.push(JSON.stringify(res.body))
  if (res.status >= 500 && res.status !== 503) serverErrors.push(`${method} ${urlPath} -> ${res.status}`)
  return res
}

/** true = "Có". `atRisk` lists the items answered the elevated way (Có on 2/5/12, Không elsewhere). */
function answers(atRisk: number[] = []): Record<string, boolean> {
  const out: Record<string, boolean> = {}
  for (let i = 1; i <= 20; i += 1) {
    const typical = ![2, 5, 12].includes(i)
    out[String(i)] = atRisk.includes(i) ? !typical : typical
  }
  return out
}

function submit(user: SeededUser, child: string, body: Record<string, unknown> = {}) {
  return call('POST', `/children/${child}/questionnaires`, {
    token: user.token,
    json: {
      instrument: 'MCHAT_RF',
      respondent: 'MOTHER',
      answers: answers(),
      consentAccepted: true,
      consentVersion: QUESTIONNAIRE_CONSENT_VERSION,
      ...body,
    },
  })
}

const getState = (id: string, user: SeededUser = parentA) =>
  call('GET', `/questionnaire-responses/${id}/follow-up`, { token: user.token })
const postAnswer = (id: string, json: Record<string, unknown>, user: SeededUser = parentA) =>
  call('POST', `/questionnaire-responses/${id}/follow-up/answer`, { token: user.token, json })
const postBack = (id: string, user: SeededUser = parentA) =>
  call('POST', `/questionnaire-responses/${id}/follow-up/back`, { token: user.token, json: {} })
const getResponse = (id: string, user: SeededUser = parentA) =>
  call('GET', `/questionnaire-responses/${id}`, { token: user.token })

function assertError(res: ApiResponse, status: number, error: string, what = '') {
  assert.equal(res.status, status, `${what} ${JSON.stringify(res.body)}`)
  assert.equal(res.body.error, error, what)
}

/** The parent-facing JSON never carries stage-1 answers, Follow-Up paths, consent snapshots or owner ids. */
function assertNoPrivateData(payload: unknown) {
  const text = JSON.stringify(payload)
  for (const key of ['"answers"', '"followUpAnswers"', '"path"', '"otherText"', '"consentStatement"', '"userId"']) {
    assert.ok(!text.includes(key), `response JSON contains ${key}`)
  }
  assert.ok(!text.includes(OTHER_MARKER), 'response JSON contains an "Other" description')
  // No scoring direction: neither the stage-1 elevated answer nor example groups.
  assert.ok(!text.includes('"elevatedOn"') && !text.includes('"group"'), 'response JSON reveals the scoring direction')
  // Example ids are position ids ("e3"): the structure ids (p…/f…/n…, …o) name the group.
  assert.ok(!/"example":"(?!e\d+")/.test(text), `response JSON carries a structure example id: ${text.slice(0, 300)}`)
  assert.ok(!/"(?!node")[A-Za-z]+":"[pfn]\d+o?"/.test(text), `response JSON carries a structure example id: ${text.slice(0, 300)}`)
}

/** Structure id (p1/f1/n1/…o) of the example at a position id ("e3") in a checklist: test-side knowledge only. */
function structureExample(item: number, node: string, positionId: string): string {
  const graph = followUpItem(item)
  const list = (graph.nodes[node] ?? graph.supplementary?.nodes[node]) as any
  const match = /^e(\d+)$/.exec(positionId)
  assert.ok(match, `not a position id: ${positionId}`)
  const example = list.examples[Number(match[1]) - 1]
  assert.ok(example, `no example at ${positionId} in ${item}.${node}`)
  return example.id as string
}

/** Position id of a structure example id. */
function positionOf(item: number, node: string, exampleId: string): string {
  const index = ((followUpItem(item).nodes[node] as any).examples as Array<{ id: string }>).findIndex((e) => e.id === exampleId)
  assert.ok(index >= 0, `${exampleId} not in ${item}.${node}`)
  return `e${index + 1}`
}

// ---------------------------------------------------------------------------
// Follow-Up driver
// ---------------------------------------------------------------------------

/**
 * Checks the view of the current question against the structure and the
 * synthetic placeholders (header, recap, copyright on every screen; texts
 * from the right keys; no scoring direction).
 */
function checkView(state: any) {
  assert.equal(state.copyrightNotice, MCHAT_RF.copyright, "the authors' copyright line on every Follow-Up screen")
  assert.equal(state.contentCopyrightNotice, CONTENT_COPYRIGHT, "plus the content file's own line")
  assertNoPrivateData(state)
  if (state.status !== 'COMPLETED') {
    for (const i of state.items) assert.deepEqual([i.score, i.needsReview], [null, false], 'item scores only once completed')
  }
  const cur = state.current
  if (!cur) return
  const { item, step } = cur
  assert.equal(cur.header, `[followUp.${item}.header]`)
  assert.equal(cur.recap, `[followUp.${item}.recap]`)
  assert.equal(cur.itemCount, state.items.length)
  assert.equal(state.items[cur.itemIndex].item, item, 'itemIndex is the 0-based index in items')
  switch (step.kind) {
    case 'PROMPT':
      assert.equal(step.text, fuText(item, step.node, 'text'))
      assert.equal(step.note, fuText(item, step.node, 'note'))
      break
    case 'YES_NO':
      assert.equal(step.text, fuText(item, step.node, 'text'))
      assert.equal(step.allowMaybe, true)
      assert.equal(step.maybeLabel, '[ui.maybe]')
      break
    case 'MAYBE_RESOLVE':
      assert.equal(step.text, '[ui.maybePrompt]')
      if (step.example !== undefined) structureExample(item, step.node, step.example)
      break
    case 'EXAMPLE': {
      assert.equal(step.stem, fuText(item, step.node, 'stem'))
      const graph = followUpItem(item)
      const node = (graph.nodes[step.node] ?? graph.supplementary?.nodes[step.node]) as any
      assert.equal(node.type, 'CHECKLIST')
      assert.equal(step.count, node.examples.length)
      assert.equal(step.example, `e${step.index + 1}`, 'position id = 1-based position in the checklist')
      assert.equal(step.text, fuText(item, step.node, 'examples', node.examples[step.index].id))
      assert.equal(step.isOther, node.examples[step.index].isOther)
      assert.equal(step.otherPlaceholder, step.isOther ? '[ui.otherDescribe]' : null)
      assert.equal(step.allowMaybe, true)
      assert.equal(step.maybeLabel, '[ui.maybe]')
      break
    }
    case 'MOST_OFTEN': {
      assert.equal(step.text, fuText(item, step.node, 'text'))
      const source = (followUpItem(item).nodes[step.node] as any).source as string
      for (const o of step.options) assert.equal(o.text, fuText(item, source, 'examples', structureExample(item, source, o.example)))
      break
    }
    case 'CHOICE':
      assert.equal(step.text, fuText(item, step.node, 'text'))
      for (const o of step.options) assert.equal(o.text, fuText(item, step.node, 'options', o.option))
      break
    default:
      assert.fail(`unknown step kind ${step.kind}`)
  }
}

/**
 * Plan of answers keyed "<item>.<node>" (structure ids, test-side knowledge):
 * a value for yes/no, choice and most-often questions; for a checklist, the
 * example ids answered "Có" (all others "Không"), plus
 * "<item>.<node>.otherText" for an endorsed Other row. Prompts are
 * acknowledged. The bodies sent carry position ids, as a client would.
 */
type Plan = Record<string, string | string[]>

/** Body that answers the current question of `state` per `plan`. */
function answerFor(state: any, plan: Plan): Record<string, unknown> {
  const { item, step } = state.current
  const key = `${item}.${step.node}`
  switch (step.kind) {
    case 'PROMPT':
      return { item, node: step.node, value: 'ACK' }
    case 'EXAMPLE': {
      const yes = ((plan[key] as string[] | undefined) ?? []).includes(structureExample(item, step.node, step.example))
      const otherText = plan[`${key}.otherText`]
      return {
        item,
        node: step.node,
        example: step.example,
        value: yes ? 'YES' : 'NO',
        ...(step.isOther && yes && typeof otherText === 'string' ? { otherText } : {}),
      }
    }
    case 'MOST_OFTEN': {
      const value = plan[key]
      assert.equal(typeof value, 'string', `no plan for ${key} (${step.kind})`)
      const source = (followUpItem(item).nodes[step.node] as any).source as string
      return { item, node: step.node, value: positionOf(item, source, value as string) }
    }
    default: {
      const value = plan[key]
      assert.equal(typeof value, 'string', `no plan for ${key} (${step.kind})`)
      return { item, node: step.node, value }
    }
  }
}

/** "item.node[.example]" with the structure example id (for the routing trace). */
function stepKey(state: any) {
  const { item, step } = state.current
  return step.kind === 'EXAMPLE' ? `${item}.${step.node}.${structureExample(item, step.node, step.example)}` : `${item}.${step.node}`
}

/**
 * Answers questions per `plan` until the Follow-Up is complete or `until`
 * holds; `trace` collects every question asked ("item.node[.example]").
 */
async function walk(id: string, state: any, plan: Plan, trace: string[], until?: (s: any) => boolean): Promise<any> {
  for (let guard = 0; guard < 200; guard += 1) {
    checkView(state)
    if (state.status === 'COMPLETED' || !state.current) return state
    if (until?.(state)) return state
    trace.push(stepKey(state))
    const res = await postAnswer(id, answerFor(state, plan))
    assert.equal(res.status, 200, `${stepKey(state)}: ${JSON.stringify(res.body)}`)
    state = res.body
  }
  throw new Error('Follow-Up walk did not end')
}

const atItem = (item: number) => (s: any) => s.current.item === item
const atKey = (key: string) => (s: any) => stepKey(s) === key

function examplesOf(item: number, node: string): string[] {
  return ((followUpItem(item).nodes[node] as any).examples as Array<{ id: string }>).map((e) => `${item}.${node}.${e.id}`)
}

// ---------------------------------------------------------------------------
// Scenarios
// ---------------------------------------------------------------------------

scenario('1. inapp + content missing/invalid → behaves like entry (inApp.available false, IN_APP submit 409, content 503); admin sees why', async () => {
  await h.startBackend({ env: { MCHAT_MODE: 'inapp', MCHAT_CONTENT_PATH: contentFile } })
  const child = await h.createChild(parentA, 'IA', 20)
  childId = child.id
  rescreenFor20Months = secondBirthday(child.dateOfBirth).toISOString()

  const list = await call('GET', '/questionnaires', { token: parentA.token })
  assert.equal(list.status, 200)
  assert.equal(list.body.enabled, true)
  assert.equal(list.body.mode, 'inapp')
  assert.deepEqual(list.body.inApp, { available: false, contentVersion: null, followUpAvailable: false })
  assert.equal(list.body.instruments[0].code, 'MCHAT_RF')

  const content = await call('GET', '/questionnaires/content', { token: parentA.token })
  assertError(content, 503, 'QUESTIONNAIRE_CONTENT_UNAVAILABLE')
  assert.ok(content.body.message, 'Vietnamese message for the parent')

  const inApp = await submit(parentA, childId, { mode: 'IN_APP', answers: answers([1, 6, 7]) })
  assertError(inApp, 409, 'QUESTIONNAIRE_CONTENT_UNAVAILABLE')
  assert.ok(inApp.body.message)
  assert.equal(await h.prisma.questionnaireResponse.count(), 0, 'nothing stored for a refused IN_APP submit')

  // Entry mode still works exactly as before.
  const entry = await submit(parentA, childId, { answers: answers([1, 6, 7]) })
  assert.equal(entry.status, 201, JSON.stringify(entry.body))
  const r = entry.body.response
  assert.equal(r.mode, 'OFFICIAL_FORM_ENTRY')
  assert.equal(r.contentVersion, null)
  assert.equal(r.band, 'MODERATE')
  assert.equal(r.followUpStatus, 'PENDING')
  assert.deepEqual(r.followUp, {
    inAppAvailable: false,
    inAppStarted: false,
    itemsDone: 0,
    itemsTotal: 3,
    needsReview: false,
    reviewItems: [],
    itemScores: [],
  })
  assertError(await getState(r.id), 503, 'QUESTIONNAIRE_CONTENT_UNAVAILABLE')
  assertError(await postAnswer(r.id, { item: 1, node: 'prompt', value: 'ACK' }), 503, 'QUESTIONNAIRE_CONTENT_UNAVAILABLE')
  assertError(await postBack(r.id), 503, 'QUESTIONNAIRE_CONTENT_UNAVAILABLE')
  // The assisted Follow-Up entry is the alternative.
  const assisted = await call('POST', `/questionnaire-responses/${r.id}/follow-up`, {
    token: parentA.token,
    json: { source: 'HEALTH_WORKER', stillFailingItems: [6] },
  })
  assert.equal(assisted.status, 200, JSON.stringify(assisted.body))
  assert.equal(assisted.body.response.outcome, 'SCREEN_NEGATIVE')
  assert.equal(assisted.body.response.rescreenAfter, rescreenFor20Months, 'negative Follow-Up before 24 months → rescreen after the 2nd birthday')

  let status = await call('GET', '/admin/questionnaires/status', { token: admin.token })
  assert.equal(status.status, 200)
  assert.equal(status.body.mode, 'inapp')
  assert.equal(status.body.content.state, 'missing')
  assert.equal(status.body.content.file, 'mchat-rf.vi.json')
  assert.deepEqual(status.body.content.errors, [])
  assert.equal(status.body.content.structureHash, structureHash())
  assert.ok(!JSON.stringify(status.body).includes(h.root), 'only the file name, never the full path')

  // The template itself (all texts empty) is invalid: key paths only.
  writeContent(contentFile, buildContentTemplate())
  status = await call('GET', '/admin/questionnaires/status', { token: admin.token })
  assert.equal(status.body.content.state, 'invalid')
  assert.ok(status.body.content.errors.length > 0)
  assert.ok(status.body.content.errors.some((e: string) => /^stage1\.1\.text: empty$/.test(e)), JSON.stringify(status.body.content.errors))
  assert.equal((await call('GET', '/questionnaires', { token: parentA.token })).body.inApp.available, false)

  // A filled file for another structure: refused (a content file can never change the routing).
  writeContent(contentFile, { ...syntheticContent(), structureHash: '0000000000000000' }, 2)
  status = await call('GET', '/admin/questionnaires/status', { token: admin.token })
  assert.equal(status.body.content.state, 'invalid')
  assert.ok(status.body.content.errors.some((e: string) => e.startsWith('structureHash:')), JSON.stringify(status.body.content.errors))
  assert.equal(status.body.content.errors.length, 1, 'only the hash is wrong')
  assertError(await call('GET', '/questionnaires/content', { token: parentA.token }), 503, 'QUESTIONNAIRE_CONTENT_UNAVAILABLE')

  // An extra key (e.g. an attempt to add an example) is refused too.
  const extra = syntheticContent() as any
  extra.followUp['4'].nodes.cl.examples.p5 = '[extra]'
  writeContent(contentFile, extra, 4)
  status = await call('GET', '/admin/questionnaires/status', { token: admin.token })
  assert.equal(status.body.content.state, 'invalid')
  assert.ok(status.body.content.errors.includes('followUp.4.nodes.cl.examples.p5: unexpected key'), JSON.stringify(status.body.content.errors))

  // A copyright line without the authors' line (e.g. only a translation credit) is refused.
  writeContent(contentFile, { ...syntheticContent(), copyrightNotice: '[translation credit only]' }, 5)
  status = await call('GET', '/admin/questionnaires/status', { token: admin.token })
  assert.equal(status.body.content.state, 'invalid')
  assert.equal(status.body.content.errors.length, 1, JSON.stringify(status.body.content.errors))
  assert.match(status.body.content.errors[0], /^copyrightNotice: must contain the authors' copyright line/)

  // Broken JSON: the error never quotes the file.
  writeContent(contentFile, '{ "instrument": "MCHAT_RF", "stage1": [SECRET-TEXT-NOT-JSON', 6)
  status = await call('GET', '/admin/questionnaires/status', { token: admin.token })
  assert.equal(status.body.content.state, 'invalid')
  assert.ok(!JSON.stringify(status.body).includes('SECRET-TEXT'), 'errors never quote the file')
  assert.ok(!h.logContains('SECRET-TEXT'), 'the backend never logs the file')
  assert.equal((await call('GET', '/questionnaires', { token: parentA.token })).body.inApp.available, false)
})

scenario('2. content ready (picked up without restart) → content endpoint; IN_APP LOW/HIGH; entry mode still offered', async () => {
  writeContent(contentFile, syntheticContent(), 8)

  const list = await call('GET', '/questionnaires', { token: parentA.token })
  assert.deepEqual(list.body.inApp, { available: true, contentVersion: CONTENT_VERSION, followUpAvailable: true })

  assert.equal((await api('GET', '/questionnaires/content')).status, 401, 'signed-in parents only')
  const c = await call('GET', '/questionnaires/content', { token: parentA.token })
  assert.equal(c.status, 200, JSON.stringify(c.body))
  assert.match(c.headers.get('cache-control') ?? '', /no-store/)
  assert.deepEqual(Object.keys(c.body).sort(), ['contentCopyrightNotice', 'contentVersion', 'copyrightNotice', 'stage1', 'translationSource', 'ui'])
  assert.equal(c.body.contentVersion, CONTENT_VERSION)
  assert.equal(c.body.copyrightNotice, MCHAT_RF.copyright, "always the authors' line")
  assert.equal(c.body.contentCopyrightNotice, CONTENT_COPYRIGHT)
  assert.equal(c.body.translationSource, 'e2e-synthetic-placeholders')
  assert.deepEqual(Object.keys(c.body.ui).sort(), [
    'followUpInstructions', 'maybe', 'maybePrompt', 'mostOftenPrompt', 'no', 'otherDescribe', 'stage1Instructions', 'yes',
  ])
  assert.equal(c.body.ui.yes, '[ui.yes]')
  assert.equal(c.body.stage1.length, 20)
  c.body.stage1.forEach((s: any, i: number) => {
    assert.deepEqual(s, { number: i + 1, text: `[stage1.${i + 1}.text]`, examples: `[stage1.${i + 1}.examples]` })
  })
  assertNoPrivateData(c.body)
  assert.ok(!JSON.stringify(c.body).includes('licenseRef'), 'license reference is for admins only')

  // LOW in app: stored with "<contentVersion>@<structureHash>", no Follow-Up state.
  const low = await submit(parentA, childId, { mode: 'IN_APP', answers: answers([1, 2]) })
  assert.equal(low.status, 201, JSON.stringify(low.body))
  assert.equal(low.body.response.mode, 'IN_APP')
  assert.equal(low.body.response.contentVersion, `${CONTENT_VERSION}@${structureHash()}`)
  assert.equal(low.body.response.band, 'LOW')
  assert.equal(low.body.response.outcome, 'SCREEN_NEGATIVE')
  assert.equal(low.body.response.followUp.inAppAvailable, false)
  assert.ok(low.body.response.rescreenAfter, 'LOW under 24 months → rescreen date')
  const lowRow = await h.prisma.questionnaireResponse.findUniqueOrThrow({ where: { id: low.body.response.id } })
  assert.equal(lowRow.followUpAnswers, null)
  assert.equal(lowRow.contentVersion, `${CONTENT_VERSION}@${structureHash()}`)
  assertError(await getState(low.body.response.id), 409, 'FOLLOW_UP_NOT_APPLICABLE')
  assertError(await postAnswer(low.body.response.id, { item: 1, node: 'prompt', value: 'ACK' }), 409, 'FOLLOW_UP_NOT_APPLICABLE')
  assertError(await postBack(low.body.response.id), 409, 'FOLLOW_UP_NOT_APPLICABLE')

  // HIGH in app: refer straight away, no Follow-Up.
  const high = await submit(parentA, childId, { mode: 'IN_APP', answers: answers([1, 2, 3, 4, 5, 6, 7, 8]) })
  assert.equal(high.status, 201)
  assert.equal(high.body.response.band, 'HIGH')
  assert.equal(high.body.response.outcome, 'REFER')
  assert.equal(high.body.response.followUpStatus, 'NOT_APPLICABLE')
  assertError(await getState(high.body.response.id), 409, 'FOLLOW_UP_NOT_APPLICABLE')

  // Validation is unchanged in app mode.
  assert.equal((await submit(parentA, childId, { mode: 'CHATBOT' })).status, 400)
  assertError(await submit(parentA, childId, { mode: 'IN_APP', answers: { ...answers(), 4: 'MAYBE' } }), 400, 'VALIDATION_ERROR')
  const missing = answers()
  delete missing['9']
  assertError(await submit(parentA, childId, { mode: 'IN_APP', answers: missing }), 400, 'INCOMPLETE_ANSWERS')
  const young = await h.createChild(parentA, 'IA-12m', 12)
  assertError(await submit(parentA, young.id, { mode: 'IN_APP' }), 422, 'AGE_OUT_OF_RANGE')
  assertError(await submit(parentB, childId, { mode: 'IN_APP' }), 404, 'CHILD_NOT_FOUND')

  // The paper-form entry stays available as the alternative.
  const entry = await submit(parentA, childId, { mode: 'OFFICIAL_FORM_ENTRY' })
  assert.equal(entry.status, 201)
  assert.equal(entry.body.response.mode, 'OFFICIAL_FORM_ENTRY')
  assert.equal(entry.body.response.contentVersion, null)
  for (const r of [low, high, entry]) assertNoPrivateData(r.body)
})

let referId = ''

scenario('3. MODERATE IN_APP → Follow-Up walk (back, STEP_MISMATCH, maybe, most-often, supplementary, preamble) → REFER', async () => {
  // Items 1, 2, 5, 6, 7 elevated → total 5 → MODERATE; Follow-Up in item order.
  const res = await submit(parentA, childId, { mode: 'IN_APP', respondent: 'FATHER', answers: answers([7, 1, 6, 2, 5]) })
  assert.equal(res.status, 201, JSON.stringify(res.body))
  const r = res.body.response
  referId = r.id
  assert.equal(r.band, 'MODERATE')
  assert.equal(r.totalScore, 5)
  assert.equal(r.outcome, 'FOLLOW_UP_NEEDED')
  assert.equal(r.followUpStatus, 'PENDING')
  assert.deepEqual(r.failedItems, [1, 2, 5, 6, 7])
  assert.deepEqual(r.followUp, {
    inAppAvailable: true,
    inAppStarted: false,
    itemsDone: 0,
    itemsTotal: 5,
    needsReview: false,
    reviewItems: [],
    itemScores: [],
  })
  const row = await h.prisma.questionnaireResponse.findUniqueOrThrow({ where: { id: referId } })
  assert.deepEqual(row.followUpAnswers, { engine: 'mchat-rf-2025-03', structureHash: structureHash(), order: [1, 2, 5, 6, 7], items: {} })

  let s = (await getState(referId)).body
  checkView(s)
  assert.equal(s.responseId, referId)
  assert.equal(s.status, 'PENDING')
  assert.deepEqual(s.items, [1, 2, 5, 6, 7].map((item) => ({ item, state: 'TODO', score: null, needsReview: false })))
  assert.equal(s.current.item, 1)
  assert.equal(s.current.itemIndex, 0)
  assert.equal(s.current.itemCount, 5)
  assert.equal(s.current.preamble, null)
  assert.equal(s.current.canGoBack, false)
  assert.equal(s.current.step.kind, 'PROMPT')
  assert.equal(s.response, undefined, 'the response DTO comes only once completed')
  assertError(await postBack(referId), 409, 'NOTHING_TO_UNDO')

  const trace: string[] = []

  // --- Item 1: prompt → p1 (then back and re-answer) → split with p1 + f1 → most often → f1 → 1
  const plan1: Plan = { '1.cl': ['p1', 'f1'], '1.mo': 'f1' }
  s = await walk(referId, s, plan1, trace, atKey('1.cl.p2'))
  assert.equal(s.current.canGoBack, true)
  assert.equal(s.items[0].state, 'IN_PROGRESS')
  s = (await postBack(referId)).body
  checkView(s)
  assert.equal(stepKey(s), '1.cl.p1', 'back removes the last recorded answer')
  assert.equal(s.current.step.index, 0)
  assert.equal(s.current.step.count, 7)
  assert.equal(s.current.step.example, 'e1')
  s = (await postAnswer(referId, { item: 1, node: 'cl', example: 'e1', value: 'YES' })).body
  trace.push('1.cl.p1')
  assert.equal(stepKey(s), '1.cl.p2')
  assert.equal(s.current.step.example, 'e2')

  // Out-of-date or malformed answers are refused and change nothing.
  const mismatches: Array<[string, Record<string, unknown>]> = [
    ['wrong example', { item: 1, node: 'cl', example: 'e3', value: 'NO' }],
    ['structure id instead of the position id', { item: 1, node: 'cl', example: 'p2', value: 'NO' }],
    ['unknown position id', { item: 1, node: 'cl', example: 'e99', value: 'NO' }],
    ['wrong node', { item: 1, node: 'prompt', value: 'ACK' }],
    ['missing example', { item: 1, node: 'cl', value: 'NO' }],
    ['wrong item', { item: 2, node: 'cl', example: 'e1', value: 'NO' }],
    ['item not in the Follow-Up', { item: 9, node: 'prompt', value: 'ACK' }],
    ['value not yes/no', { item: 1, node: 'cl', example: 'e2', value: 'ACK' }],
    ['MAYBE on another example', { item: 1, node: 'cl', example: 'e3', value: 'MAYBE' }],
    ['MAYBE without the example', { item: 1, node: 'cl', value: 'MAYBE' }],
    ['otherText on a regular row', { item: 1, node: 'cl', example: 'e2', value: 'YES', otherText: 'x' }],
  ]
  for (const [what, body] of mismatches) assertError(await postAnswer(referId, body), 409, 'STEP_MISMATCH', what)
  for (const body of [
    { item: 21, node: 'prompt', value: 'ACK' },
    { item: 1, node: 'cl', example: 'e2' },
    { item: 1, node: '', value: 'YES' },
    { item: 1, node: 'cl', example: 'e2', value: 'YES', maybe: 'yes' },
  ]) {
    assertError(await postAnswer(referId, body), 400, 'VALIDATION_ERROR', JSON.stringify(body))
  }
  // A body that is not JSON: 400 INVALID_JSON, and neither the body nor its excerpt is echoed or logged.
  const BODY_MARKER = 'E2E-RAW-BODY-c41d'
  const raw = await fetch(`http://127.0.0.1:${BACKEND_PORT}/api/questionnaire-responses/${referId}/follow-up/answer`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${parentA.token}`, 'Content-Type': 'application/json' },
    body: `{"item": 1, "otherText": "${BODY_MARKER}", ,,}`,
  })
  const rawText = await raw.text()
  assert.equal(raw.status, 400, rawText)
  assert.deepEqual(JSON.parse(rawText), { error: 'INVALID_JSON' })
  await new Promise((r) => setTimeout(r, 300))
  assert.ok(h.logContains('Request failed: SyntaxError (entity.parse.failed, 400)'), h.backendLog.slice(-5).join('\n'))
  assert.ok(!h.logContains(BODY_MARKER), 'the raw body was logged')
  s = (await getState(referId)).body
  assert.equal(stepKey(s), '1.cl.p2', 'refused answers changed nothing')

  // "Maybe" on an example row → its resolution question (nothing recorded) → resolved "no".
  const exampleMaybe = await postAnswer(referId, { item: 1, node: 'cl', example: 'e2', value: 'MAYBE' })
  assert.equal(exampleMaybe.status, 200, JSON.stringify(exampleMaybe.body))
  checkView(exampleMaybe.body)
  assert.deepEqual(exampleMaybe.body.current.step, { kind: 'MAYBE_RESOLVE', node: 'cl', text: '[ui.maybePrompt]', example: 'e2' })
  assert.equal(stepKey((await getState(referId)).body), '1.cl.p2', 'a "maybe" is not recorded')
  s = (await postAnswer(referId, { item: 1, node: 'cl', example: 'e2', value: 'NO', maybe: true })).body
  trace.push('1.cl.p2')
  assert.equal(stepKey(s), '1.cl.p3')

  s = await walk(referId, s, plan1, trace, (x) => x.current.step.kind === 'MOST_OFTEN')
  assert.equal(s.current.step.kind, 'MOST_OFTEN')
  assert.equal(s.current.step.node, 'mo')
  assert.deepEqual(s.current.step.options.map((o: any) => o.example), ['e1', 'e5'], 'endorsed examples (position ids), original order')
  assertError(await postAnswer(referId, { item: 1, node: 'mo', value: 'e2' }), 409, 'STEP_MISMATCH', 'option not endorsed')
  assertError(await postAnswer(referId, { item: 1, node: 'mo', value: 'f1' }), 409, 'STEP_MISMATCH', 'structure id as option')
  assertError(await postAnswer(referId, { item: 1, node: 'mo', value: 'MAYBE' }), 409, 'STEP_MISMATCH', 'maybe on most-often')

  // --- Item 2: both examples no → 0, then the unscored supplementary (s1 yes → s2 choice)
  const plan2: Plan = { '2.cl': [], '2.s1': 'YES', '2.s2': 'r2' }
  s = await walk(referId, s, { ...plan1, ...plan2 }, trace, atItem(2))
  assert.deepEqual(s.items[0], { item: 1, state: 'DONE', score: null, needsReview: false }, 'scores hidden until completed')
  assert.equal(s.current.itemIndex, 1)
  assert.equal(s.current.step.kind, 'EXAMPLE', 'item 2 starts at its checklist')
  s = await walk(referId, s, plan2, trace, atKey('2.s2'))
  assert.equal(s.current.step.kind, 'CHOICE')
  assert.deepEqual(s.current.step.options.map((o: any) => o.option), ['r1', 'r2', 'r3'])
  assertError(await postAnswer(referId, { item: 2, node: 's2', value: 'r4' }), 409, 'STEP_MISMATCH', 'unknown option')
  s = await walk(referId, s, plan2, trace, atItem(5))
  assert.deepEqual(s.items[1], { item: 2, state: 'DONE', score: null, needsReview: false })

  // Back on the first question of item 5 re-opens item 2 and removes its last answer.
  assert.equal(s.current.canGoBack, true)
  s = (await postBack(referId)).body
  checkView(s)
  assert.equal(stepKey(s), '2.s2')
  assert.equal(s.items[1].state, 'IN_PROGRESS')
  s = await walk(referId, s, plan2, trace, atItem(5))

  // --- Item 5: f2 yes → frequency question → "maybe" → resolved yes → 1
  assertError(await postAnswer(referId, { item: 5, node: 'prompt', value: 'MAYBE' }), 409, 'STEP_MISMATCH', 'maybe on a prompt')
  const plan5: Plan = { '5.cl': ['f2'] }
  s = await walk(referId, s, plan5, trace, atKey('5.freq'))
  assert.equal(s.current.step.kind, 'YES_NO')
  const maybe = await postAnswer(referId, { item: 5, node: 'freq', value: 'MAYBE' })
  assert.equal(maybe.status, 200, JSON.stringify(maybe.body))
  checkView(maybe.body)
  assert.deepEqual(maybe.body.current.step, { kind: 'MAYBE_RESOLVE', node: 'freq', text: '[ui.maybePrompt]' })
  const notRecorded = (await getState(referId)).body
  assert.equal(notRecorded.current.step.kind, 'YES_NO', 'a "maybe" is not recorded')
  s = (await postAnswer(referId, { item: 5, node: 'freq', value: 'YES', maybe: true })).body
  trace.push('5.freq')
  assert.deepEqual(s.items[2], { item: 5, state: 'DONE', score: null, needsReview: false })

  // --- Item 6: only n4 → probe no → 1 (no preamble on item 6)
  const plan6: Plan = { '6.cl': ['n4'], '6.q1': 'NO' }
  assert.equal(s.current.item, 6)
  assert.equal(s.current.preamble, null)
  s = await walk(referId, s, plan6, trace, atItem(7))
  assert.deepEqual(s.items[3], { item: 6, state: 'DONE', score: null, needsReview: false })

  // --- Item 7 right after item 6: the preamble is shown on its screens; n2 → q1 yes → q2 "both" → 0
  const plan7: Plan = { '7.cl': ['n2'], '7.q1': 'YES', '7.q2': 'optBoth' }
  const preambles: Array<string | null> = []
  s = await walk(referId, s, plan7, trace, (x) => {
    preambles.push(x.current.preamble)
    return false
  })
  assert.ok(preambles.length >= 6)
  assert.ok(preambles.every((p) => p === '[followUp.7.preambles.after6]'), JSON.stringify(preambles))

  // --- Completed: 1, 5, 6 still score 1 → REFER
  assert.equal(s.status, 'COMPLETED')
  assert.equal(s.current, null)
  assert.deepEqual(s.items, [
    { item: 1, state: 'DONE', score: 1, needsReview: false },
    { item: 2, state: 'DONE', score: 0, needsReview: false },
    { item: 5, state: 'DONE', score: 1, needsReview: false },
    { item: 6, state: 'DONE', score: 1, needsReview: false },
    { item: 7, state: 'DONE', score: 0, needsReview: false },
  ])
  const done = s.response
  assert.equal(done.id, referId)
  assert.equal(done.outcome, 'REFER')
  assert.equal(done.followUpStatus, 'COMPLETED')
  assert.equal(done.followUpSource, 'IN_APP')
  assert.equal(done.followUpFailCount, 3)
  assert.deepEqual(done.followUpFailedItems, [1, 5, 6])
  assert.deepEqual(done.failedItems, [])
  assert.deepEqual(done.followUp, {
    inAppAvailable: false,
    inAppStarted: true,
    itemsDone: 5,
    itemsTotal: 5,
    needsReview: false,
    reviewItems: [],
    itemScores: [
      { item: 1, score: 1 },
      { item: 2, score: 0 },
      { item: 5, score: 1 },
      { item: 6, score: 1 },
      { item: 7, score: 0 },
    ],
  })
  assert.ok(done.actions.title)

  // The routing that was walked (the server decided every next question).
  assert.deepEqual(trace, [
    '1.prompt', '1.cl.p1', '1.cl.p1', '1.cl.p2', '1.cl.p3', '1.cl.p4', '1.cl.f1', '1.cl.f2', '1.cl.f3', '1.mo',
    '2.cl.f1', '2.cl.f2', '2.s1', '2.s2', '2.s2',
    '5.prompt', ...examplesOf(5, 'cl'), '5.freq',
    '6.prompt', ...examplesOf(6, 'cl'), '6.q1',
    '7.prompt', ...examplesOf(7, 'cl'), '7.q1', '7.q2',
  ])

  // Stored for the audit trail: paths (with the maybe flag) and per-item scores.
  const stored = await h.prisma.questionnaireResponse.findUniqueOrThrow({ where: { id: referId } })
  assert.equal(stored.followUpStatus, 'COMPLETED')
  assert.equal(stored.followUpSource, 'IN_APP')
  assert.ok(stored.followUpCompletedAt)
  assert.deepEqual(stored.followUpFailedItems, [1, 5, 6])
  const fa = stored.followUpAnswers as any
  assert.deepEqual(fa.items['5'].path.at(-1), { node: 'freq', value: 'YES', maybe: true })
  // Stored with structure ids; a resolved "maybe" on an example row is kept as such.
  assert.deepEqual(fa.items['1'].path[2], { node: 'cl', example: 'p2', value: 'NO', maybe: true })
  assert.deepEqual(fa.items['2'].path.slice(-2), [{ node: 's1', value: 'YES' }, { node: 's2', value: 'r2' }])
  assert.equal(fa.items['1'].score, 1)
  assert.equal(fa.items['7'].score, 0)

  // Nothing can change a completed Follow-Up.
  assertError(await postAnswer(referId, { item: 7, node: 'q2', value: 'optB' }), 409, 'FOLLOW_UP_NOT_APPLICABLE')
  assertError(await postBack(referId), 409, 'FOLLOW_UP_NOT_APPLICABLE')
  assertError(
    await call('POST', `/questionnaire-responses/${referId}/follow-up`, {
      token: parentA.token,
      json: { source: 'HEALTH_WORKER', stillFailingItems: [] },
    }),
    409,
    'FOLLOW_UP_NOT_APPLICABLE',
  )
  const afterDone = await getState(referId)
  assert.equal(afterDone.status, 200)
  checkView(afterDone.body)
  assert.equal(afterDone.body.current, null)
  assert.equal(afterDone.body.response.outcome, 'REFER')
  const read = await getResponse(referId)
  assert.equal(read.body.response.followUpSource, 'IN_APP')
  assertNoPrivateData(read.body)
})

let negativeId = ''

scenario('4. IN_APP Follow-Up → SCREEN_NEGATIVE (items 3, 8, 12, 14, 18, 19; "Other" → review flag; stop at first yes)', async () => {
  const res = await submit(parentA, childId, { mode: 'IN_APP', answers: answers([3, 8, 12, 14, 18, 19]) })
  assert.equal(res.status, 201, JSON.stringify(res.body))
  negativeId = res.body.response.id
  assert.equal(res.body.response.band, 'MODERATE')
  assert.equal(res.body.response.totalScore, 6)

  const plan: Plan = {
    // 3: only the Other row, with a description → not counted → 1, flagged for review
    '3.cl': ['p11o'],
    '3.cl.otherText': `  ${OTHER_MARKER}  `,
    // 8: q1 no → q2 yes → prompt → p3 → more than half of the time → 0
    '8.q1': 'NO',
    '8.q2': 'YES',
    '8.cl': ['p3'],
    '8.freq': 'YES',
    // 12: one of the count list + its Other row → counted (fail-leaning list) → 2 → prompt
    //     → only a pass-type reaction → 0, flagged for review (not counting it would have ended at 0 earlier)
    '12.cnt': ['n1', 'n10o'],
    '12.cnt.otherText': OTHER_MARKER,
    '12.cl': ['p1'],
    // 14: exactly one → daily yes → at least 5 a day yes → 0
    '14.cnt': ['n3'],
    '14.f1': 'YES',
    '14.f2': 'YES',
    // 18: q1 no → q2 yes → ordered examples, stop at the first yes (n2) → 0
    '18.q1': 'NO',
    '18.q2': 'YES',
    '18.cl': ['n2', 'n3'],
    // 19: no, no, yes → 0
    '19.q1': 'NO',
    '19.q2': 'NO',
    '19.q3': 'YES',
  }
  const trace: string[] = []
  let s = (await getState(negativeId)).body
  s = await walk(negativeId, s, plan, trace, atKey('3.cl.p11o'))
  assert.equal(s.current.step.isOther, true)
  assert.equal(s.current.step.otherPlaceholder, '[ui.otherDescribe]')
  assertError(
    await postAnswer(negativeId, { item: 3, node: 'cl', example: 'e11', value: 'YES', otherText: 'x'.repeat(201) }),
    400,
    'VALIDATION_ERROR',
    'otherText over 200 characters',
  )
  s = await walk(negativeId, s, plan, trace, atItem(8))
  assert.deepEqual(s.items[0], { item: 3, state: 'DONE', score: null, needsReview: false }, 'score and review flag hidden while pending')
  assert.equal(s.current.step.kind, 'YES_NO', 'item 8 starts with a question')
  s = await walk(negativeId, s, plan, trace)

  assert.equal(s.status, 'COMPLETED')
  assert.deepEqual(
    s.items.map((i: any) => [i.item, i.score, i.needsReview]),
    [[3, 1, true], [8, 0, false], [12, 0, true], [14, 0, false], [18, 0, false], [19, 0, false]],
  )
  const done = s.response
  assert.equal(done.outcome, 'SCREEN_NEGATIVE')
  assert.equal(done.followUpSource, 'IN_APP')
  assert.equal(done.followUpFailCount, 1)
  assert.deepEqual(done.followUpFailedItems, [3])
  assert.equal(done.followUp.needsReview, true)
  assert.deepEqual(done.followUp.reviewItems, [3, 12])
  assert.equal(done.rescreenAfter, rescreenFor20Months, 'negative Follow-Up before 24 months → rescreen after the 2nd birthday')
  assert.ok(done.actions.body.join(' ').includes('sinh nhật 2 tuổi'))

  assert.deepEqual(trace, [
    '3.prompt', ...examplesOf(3, 'cl'),
    '8.q1', '8.q2', '8.prompt', ...examplesOf(8, 'cl'), '8.freq',
    ...['12.cnt.n1', '12.cnt.n2', '12.cnt.n3', '12.cnt.n4', '12.cnt.n5', '12.cnt.n6', '12.cnt.n7', '12.cnt.n8', '12.cnt.n9', '12.cnt.n10o'],
    '12.prompt', ...examplesOf(12, 'cl'),
    '14.prompt', ...['14.cnt.n1', '14.cnt.n2', '14.cnt.n3', '14.cnt.n4', '14.cnt.n5', '14.cnt.n6'], '14.f1', '14.f2',
    '18.q1', '18.q2', '18.cl.n1', '18.cl.n2',
    '19.q1', '19.q2', '19.q3',
  ])
  assert.ok(!trace.includes('18.cl.n3'), 'item 18 stops at the first yes')
  assert.ok(!trace.includes('12.mo'), 'no most-often question when only one group is endorsed')

  // The description is stored (trimmed) for the health worker's review, never output.
  const stored = await h.prisma.questionnaireResponse.findUniqueOrThrow({ where: { id: negativeId } })
  const fa = stored.followUpAnswers as any
  assert.deepEqual(fa.items['3'].path.at(-1), { node: 'cl', example: 'p11o', value: 'YES', otherText: OTHER_MARKER })
  assert.equal(fa.items['3'].needsReview, true)
  assert.deepEqual(fa.items['12'].path[9], { node: 'cnt', example: 'n10o', value: 'YES', otherText: OTHER_MARKER })
  assert.equal(fa.items['12'].needsReview, true)
  const row = await h.prisma.questionnaireResponse.findUniqueOrThrow({ where: { id: negativeId } })
  assert.equal(row.rescreenAfter?.toISOString(), rescreenFor20Months)
  const read = await getResponse(negativeId)
  assertNoPrivateData(read.body)
  assert.deepEqual(read.body.response.followUp.itemScores.map((x: any) => x.score), [1, 0, 0, 0, 0, 0])
})

scenario('5. assisted override replaces partial in-app answers; entry-mode MODERATE can take the in-app Follow-Up; ownership', async () => {
  // Items 7, 13, 15 → item 7 comes first: no preamble.
  const res = await submit(parentA, childId, { mode: 'IN_APP', answers: answers([13, 7, 15]) })
  const id = res.body.response.id as string
  let s = (await getState(id)).body
  assert.equal(s.current.item, 7)
  assert.equal(s.current.preamble, null, 'the item-7 preamble needs item 6 just before')
  s = await walk(id, s, { '7.cl': ['n1'], '7.q1': 'NO' }, [], atItem(13))
  assert.deepEqual(s.items[0], { item: 7, state: 'DONE', score: null, needsReview: false })

  let read = (await getResponse(id)).body.response
  assert.deepEqual(
    { ...read.followUp },
    { inAppAvailable: true, inAppStarted: true, itemsDone: 1, itemsTotal: 3, needsReview: false, reviewItems: [], itemScores: [] },
  )
  const childList = await call('GET', `/children/${childId}/questionnaires`, { token: parentA.token })
  const listed = childList.body.responses.find((x: any) => x.id === id)
  assert.equal(listed.followUp.inAppStarted, true, 'the child page can show "Đang làm dở"')
  assert.equal(listed.followUp.itemsDone, 1)
  assertNoPrivateData(childList.body)

  // Other users never reach it (admins included: they never see answers).
  for (const user of [parentB, admin]) {
    assertError(await getState(id, user), 404, 'RESPONSE_NOT_FOUND')
    assertError(await postAnswer(id, { item: 13, node: 'q1', value: 'YES' }, user), 404, 'RESPONSE_NOT_FOUND')
    assertError(await postBack(id, user), 404, 'RESPONSE_NOT_FOUND')
    assertError(
      await call('POST', `/questionnaire-responses/${id}/follow-up`, {
        token: user.token,
        json: { source: 'HEALTH_WORKER', stillFailingItems: [] },
      }),
      404,
      'RESPONSE_NOT_FOUND',
    )
  }

  // Assisted entry while the in-app Follow-Up is half done: it wins and clears the partial answers.
  const assisted = await call('POST', `/questionnaire-responses/${id}/follow-up`, {
    token: parentA.token,
    json: { source: 'HEALTH_WORKER', stillFailingItems: [7, 15] },
  })
  assert.equal(assisted.status, 200, JSON.stringify(assisted.body))
  read = assisted.body.response
  assert.equal(read.outcome, 'REFER')
  assert.equal(read.followUpSource, 'HEALTH_WORKER')
  assert.deepEqual(read.followUpFailedItems, [7, 15])
  assert.equal(read.rescreenAfter, null, 'no rescreen date for a positive Follow-Up')
  assert.deepEqual(read.followUp, {
    inAppAvailable: false,
    inAppStarted: false,
    itemsDone: 0,
    itemsTotal: 3,
    needsReview: false,
    reviewItems: [],
    itemScores: [
      { item: 7, score: 1 },
      { item: 13, score: 0 },
      { item: 15, score: 1 },
    ],
  })
  const row = await h.prisma.questionnaireResponse.findUniqueOrThrow({ where: { id } })
  assert.equal(row.followUpAnswers, null)
  assertError(await postAnswer(id, { item: 13, node: 'q1', value: 'YES' }), 409, 'FOLLOW_UP_NOT_APPLICABLE')
  assertError(await postBack(id), 409, 'FOLLOW_UP_NOT_APPLICABLE')
  const state = (await getState(id)).body
  checkView(state)
  assert.equal(state.status, 'COMPLETED')
  assert.equal(state.current, null)
  assert.deepEqual(state.items.map((i: any) => [i.item, i.state, i.score]), [[7, 'DONE', 1], [13, 'DONE', 0], [15, 'DONE', 1]])
  assert.equal(state.response.followUpSource, 'HEALTH_WORKER')

  // A MODERATE response entered from the paper form can take the in-app Follow-Up (state created on first use).
  const entry = (await submit(parentA, childId, { answers: answers([19, 4, 13]) })).body.response
  assert.equal(entry.mode, 'OFFICIAL_FORM_ENTRY')
  assert.equal(entry.followUp.inAppAvailable, true)
  assert.equal((await h.prisma.questionnaireResponse.findUniqueOrThrow({ where: { id: entry.id } })).followUpAnswers, null)
  let es = (await getState(entry.id)).body
  assert.equal(es.current.item, 4)
  assert.equal(es.current.itemCount, 3)
  es = await walk(entry.id, es, { '4.cl': ['p2'], '13.q1': 'YES', '19.q1': 'NO', '19.q2': 'NO', '19.q3': 'NO' }, [])
  assert.equal(es.response.outcome, 'SCREEN_NEGATIVE')
  assert.equal(es.response.followUpSource, 'IN_APP')
  assert.equal(es.response.mode, 'OFFICIAL_FORM_ENTRY')
  assert.deepEqual(es.response.followUpFailedItems, [19])
  assert.equal(es.response.rescreenAfter, rescreenFor20Months)

  // A child of 24 months or more gets no rescreen date after a negative Follow-Up.
  const older = await h.createChild(parentA, 'IA-26m', 26)
  const olderRes = (await submit(parentA, older.id, { mode: 'IN_APP', answers: answers([13, 19, 4]) })).body.response
  let os = (await getState(olderRes.id)).body
  os = await walk(olderRes.id, os, { '4.cl': ['p1'], '13.q1': 'YES', '19.q1': 'YES' }, [])
  assert.equal(os.response.outcome, 'SCREEN_NEGATIVE')
  assert.equal(os.response.rescreenAfter, null)
})

let pendingId = ''

scenario('6. concurrent answers are serialised (row lock): one recorded, the rest STEP_MISMATCH', async () => {
  const res = await submit(parentA, childId, { mode: 'IN_APP', answers: answers([10, 11, 16, 17]) })
  pendingId = res.body.response.id
  const body = { item: 10, node: 'prompt', value: 'ACK' }
  const results = await Promise.all(Array.from({ length: 6 }, () => postAnswer(pendingId, body)))
  const ok = results.filter((r) => r.status === 200)
  assert.equal(ok.length, 1, JSON.stringify(results.map((r) => [r.status, r.body.error])))
  for (const r of results.filter((x) => x.status !== 200)) assertError(r, 409, 'STEP_MISMATCH')
  const row = await h.prisma.questionnaireResponse.findUniqueOrThrow({ where: { id: pendingId } })
  assert.deepEqual((row.followUpAnswers as any).items, { '10': { path: [{ node: 'prompt', value: 'ACK' }] } })

  // Two different answers to the same example at once: exactly one wins.
  const [a, b] = await Promise.all([
    postAnswer(pendingId, { item: 10, node: 'cl', example: 'e1', value: 'YES' }),
    postAnswer(pendingId, { item: 10, node: 'cl', example: 'e1', value: 'NO' }),
  ])
  assert.deepEqual([a.status, b.status].sort(), [200, 409])
  const s = (await getState(pendingId)).body
  assert.equal(stepKey(s), '10.cl.p2')
})

scenario('7. content removed mid-Follow-Up → 503, partial answers kept; restored → resumes where it stopped', async () => {
  assert.ok(pendingId, 'scenario 6 must have run')
  const aside = `${contentFile}.aside`
  fs.renameSync(contentFile, aside)
  try {
    assert.deepEqual((await call('GET', '/questionnaires', { token: parentA.token })).body.inApp, { available: false, contentVersion: null, followUpAvailable: false })
    assertError(await getState(pendingId), 503, 'QUESTIONNAIRE_CONTENT_UNAVAILABLE')
    assertError(await postAnswer(pendingId, { item: 10, node: 'cl', example: 'e2', value: 'NO' }), 503, 'QUESTIONNAIRE_CONTENT_UNAVAILABLE')
    assertError(await postBack(pendingId), 503, 'QUESTIONNAIRE_CONTENT_UNAVAILABLE')
    const read = (await getResponse(pendingId)).body.response
    assert.equal(read.followUp.inAppAvailable, false)
    assert.equal(read.followUp.inAppStarted, true, 'the partial answers are kept')
    const status = (await call('GET', '/admin/questionnaires/status', { token: admin.token })).body
    assert.equal(status.content.state, 'missing')
  } finally {
    fs.renameSync(aside, contentFile)
  }
  const s = (await getState(pendingId)).body
  checkView(s)
  assert.equal(stepKey(s), '10.cl.p2', 'resumes from the stored path')
  assert.equal(s.current.canGoBack, true)
})

scenario('8. admin status: aggregates only (no answers, children, texts or paths); admins only', async () => {
  const res = await call('GET', '/admin/questionnaires/status', { token: admin.token })
  assert.equal(res.status, 200)
  const body = res.body
  assert.deepEqual(Object.keys(body).sort(), ['content', 'counts', 'mode'])
  assert.equal(body.mode, 'inapp')
  assert.deepEqual(body.content, {
    state: 'ready',
    stage1Ready: true,
    file: 'mchat-rf.vi.json',
    errors: [],
    contentVersion: CONTENT_VERSION,
    licenseRef: 'e2e-no-license-synthetic',
    translationSource: 'e2e-synthetic-placeholders',
    structureVersion: 'mchat-rf-2025-03',
    structureHash: structureHash(),
  })
  const p = h.prisma.questionnaireResponse
  assert.deepEqual(body.counts, {
    total: await p.count(),
    byBand: {
      LOW: await p.count({ where: { band: 'LOW' } }),
      MODERATE: await p.count({ where: { band: 'MODERATE' } }),
      HIGH: await p.count({ where: { band: 'HIGH' } }),
    },
    followUpPending: await p.count({ where: { followUpStatus: 'PENDING' } }),
    inApp: await p.count({ where: { mode: 'IN_APP' } }),
  })
  assert.ok(body.counts.inApp >= 6 && body.counts.followUpPending >= 1)
  const text = JSON.stringify(body)
  assert.ok(!text.includes('Bé '), 'no child names')
  assert.ok(!/[0-9a-f]{8}-[0-9a-f]{4}-/.test(text), 'no ids')
  assert.ok(!text.includes('[stage1.') && !text.includes('[followUp.') && !text.includes('[ui.'), 'no licensed text')
  assert.ok(!text.includes(OTHER_MARKER))
  assert.ok(!text.includes(h.root))
  assertNoPrivateData(body)

  assert.equal((await api('GET', '/admin/questionnaires/status', { token: parentA.token })).status, 403)
  assert.equal((await api('GET', '/admin/questionnaires/status')).status, 401)
})

scenario('9. default MCHAT_CONTENT_PATH (relative to the backend cwd); entry ignores ready content; off blocks every change', async () => {
  await h.stopBackend()
  // Default path: <cwd>/content/mchat-rf.vi.json (the harness runs the backend in a temp cwd).
  const cwdName = 'backend-cwd-default-content'
  writeContent(path.join(h.root, cwdName, 'content', 'mchat-rf.vi.json'), syntheticContent())
  await h.startBackend({ cwdName, env: { MCHAT_MODE: 'inapp' } })
  assert.deepEqual((await call('GET', '/questionnaires', { token: parentA.token })).body.inApp, {
    available: true,
    contentVersion: CONTENT_VERSION,
    followUpAvailable: true,
  })
  assert.equal((await getState(pendingId)).status, 200)

  await h.startBackend({ cwdName, env: { MCHAT_MODE: 'entry' } })
  const entryList = await call('GET', '/questionnaires', { token: parentA.token })
  assert.equal(entryList.body.mode, 'entry')
  assert.deepEqual(entryList.body.inApp, { available: false, contentVersion: null, followUpAvailable: false })
  assertError(await call('GET', '/questionnaires/content', { token: parentA.token }), 503, 'QUESTIONNAIRE_CONTENT_UNAVAILABLE')
  assertError(await submit(parentA, childId, { mode: 'IN_APP' }), 409, 'QUESTIONNAIRE_CONTENT_UNAVAILABLE')
  assertError(await getState(pendingId), 503, 'QUESTIONNAIRE_CONTENT_UNAVAILABLE')
  assert.equal((await getResponse(pendingId)).body.response.followUp.inAppAvailable, false)

  await h.startBackend({ cwdName, env: { MCHAT_MODE: 'off' } })
  const offList = await call('GET', '/questionnaires', { token: parentA.token })
  assert.equal(offList.body.enabled, false)
  assert.deepEqual(offList.body.inApp, { available: false, contentVersion: null, followUpAvailable: false })
  assertError(await submit(parentA, childId, { mode: 'IN_APP' }), 503, 'QUESTIONNAIRE_DISABLED')
  assertError(await postAnswer(pendingId, { item: 10, node: 'cl', example: 'e2', value: 'NO' }), 503, 'QUESTIONNAIRE_DISABLED')
  assertError(await postBack(pendingId), 503, 'QUESTIONNAIRE_DISABLED')
  // Stored responses stay readable and deletable.
  assert.equal((await getResponse(referId)).status, 200)
  assert.equal((await call('DELETE', `/questionnaire-responses/${negativeId}`, { token: parentA.token })).status, 200)
  assert.equal(await h.prisma.questionnaireResponse.count({ where: { id: negativeId } }), 0)
  await h.stopBackend()
})

scenario('9b. stage 1 only (Follow-Up texts empty): items in the app, Follow-Up stays the assisted entry', async () => {
  // Synthetic stage 1 + metadata; every Follow-Up text and the Follow-Up-only ui labels left empty.
  const blank = buildContentTemplate()
  const stage1Only = syntheticContent() as Record<string, any>
  stage1Only.followUp = blank.followUp
  stage1Only.ui = { ...blank.ui, stage1Instructions: '[ui.stage1Instructions]' }
  const file = path.join(h.root, 'licensed-content-stage1', 'mchat-rf.vi.json')
  writeContent(file, stage1Only)
  await h.startBackend({ env: { MCHAT_MODE: 'inapp', MCHAT_CONTENT_PATH: file } })

  const list = await call('GET', '/questionnaires', { token: parentA.token })
  assert.deepEqual(list.body.inApp, { available: true, contentVersion: CONTENT_VERSION, followUpAvailable: false })
  const content = await call('GET', '/questionnaires/content', { token: parentA.token })
  assert.equal(content.status, 200)
  assert.equal(content.body.stage1.length, 20)
  assert.equal(content.body.stage1[6].text, '[stage1.7.text]')
  assert.equal(content.body.ui.stage1Instructions, '[ui.stage1Instructions]')

  const status = await call('GET', '/admin/questionnaires/status', { token: admin.token })
  assert.equal(status.body.content.state, 'invalid')
  assert.equal(status.body.content.stage1Ready, true)

  // Score 3 → MODERATE: no automated Follow-Up is started.
  const res = await submit(parentA, childId, { mode: 'IN_APP', answers: answers([1, 6, 7]) })
  assert.equal(res.status, 201)
  const r = res.body.response
  assert.equal(r.mode, 'IN_APP')
  assert.equal(r.band, 'MODERATE')
  assert.equal(r.followUpStatus, 'PENDING')
  assert.equal(r.followUp.inAppAvailable, false)
  assert.equal(r.contentVersion, `${CONTENT_VERSION}@${structureHash()}`)
  const row = await h.prisma.questionnaireResponse.findUniqueOrThrow({ where: { id: r.id } })
  assert.equal(row.followUpAnswers, null)
  assertError(await getState(r.id), 503, 'QUESTIONNAIRE_CONTENT_UNAVAILABLE')

  // The assisted Follow-Up entry completes it.
  const assisted = await call('POST', `/questionnaire-responses/${r.id}/follow-up`, {
    token: parentA.token,
    json: { source: 'HEALTH_WORKER', stillFailingItems: [1, 6] },
  })
  assert.equal(assisted.status, 200)
  assert.equal(assisted.body.response.followUpStatus, 'COMPLETED')
  assert.equal(assisted.body.response.outcome, 'REFER')
  await h.stopBackend()
})

scenario('10. privacy + logs: no body or log line carries answers, "Other" descriptions, licensed text or child names; no 500s', async () => {
  assert.deepEqual(serverErrors, [])
  const bad = h.allBackendLogs.filter((l) => /-> 5\d\d$|UnhandledPromiseRejection|INTERNAL_SERVER_ERROR/.test(l) && !/-> 503$/.test(l))
  assert.deepEqual(bad, [])
  assert.ok(seenBodies.length > 100, `only ${seenBodies.length} bodies recorded`)
  for (const body of seenBodies) {
    assert.ok(!body.includes(OTHER_MARKER), 'an "Other" description was returned')
    assert.ok(!body.includes('"followUpAnswers"') && !body.includes('"answers"'), 'stored answers were returned')
  }
  const logs = h.allBackendLogs.join('\n')
  assert.ok(!logs.includes(OTHER_MARKER), 'an "Other" description was logged')
  assert.ok(!logs.includes('[stage1.') && !logs.includes('[followUp.') && !logs.includes('[ui.'), 'licensed text was logged')
  assert.ok(!logs.includes('SECRET-TEXT'), 'the content file was logged')
  assert.ok(!logs.includes('(E2E)'), 'a child name was logged')
})
