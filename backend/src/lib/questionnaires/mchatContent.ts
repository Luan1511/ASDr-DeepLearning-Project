/**
 * Licensed M-CHAT-R/F text for the in-app mode: a JSON file outside git
 * (MCHAT_CONTENT_PATH, default content/mchat-rf.vi.json) that holds text only,
 * keyed by the ids of mchatRfStructure.ts. The file must name the repo's
 * structureHash(), so it can never change the routing.
 *
 * Stage 1 can be offered before the Follow-Up pages are filled in: a file whose
 * only empty texts belong to the Follow-Up is "stage-1 ready" (state stays
 * "invalid", stage1Ready true). The Follow-Up itself needs the full file.
 *
 * Nothing in this module logs or returns the text except getReadyContent()
 * and getStage1Content(); validation errors name key paths only.
 */
import fs from 'fs'
import path from 'path'
import {
  MCHAT_RF_STRUCTURE,
  STRUCTURE_VERSION,
  structureHash,
  type FollowUpItemStructure,
  type FollowUpNode,
} from './mchatRfStructure'

export const DEFAULT_CONTENT_PATH = 'content/mchat-rf.vi.json'
export const TEXT_MAX_LENGTH = 4000
const FILE_MAX_BYTES = 2 * 1024 * 1024
const MAX_LISTED_STRUCTURAL = 50
const MAX_LISTED_EMPTY = 20

export const UI_KEYS = [
  'stage1Instructions',
  'yes',
  'no',
  'maybe',
  'maybePrompt',
  'mostOftenPrompt',
  'otherDescribe',
  'followUpInstructions',
] as const
export type UiKey = (typeof UI_KEYS)[number]

export type PromptContent = { text: string; note: string }
export type TextContent = { text: string }
export type ChecklistContent = { stem: string; examples: Record<string, string> }
export type ChoiceContent = { text: string; options: Record<string, string> }
export type NodeContent = PromptContent | TextContent | ChecklistContent | ChoiceContent

export type FollowUpItemContent = {
  header: string
  recap: string
  nodes: Record<string, NodeContent>
  /** Item 2 only. */
  supplementary?: Record<string, NodeContent>
  /** Item 7 only: { after6 }. */
  preambles?: Record<string, string>
}

export type McHatContentFile = {
  instrument: 'MCHAT_RF'
  structureVersion: typeof STRUCTURE_VERSION
  structureHash: string
  /** Short id of the source text, e.g. "ccihp-2015-vi". */
  contentVersion: string
  locale: string
  /** Reference of the authors' written permission (date / message id). */
  licenseRef: string
  translationSource: string
  copyrightNotice: string
  ui: Record<UiKey, string>
  /** "1".."20" */
  stage1: Record<string, { text: string; examples: string }>
  /** "1".."20" */
  followUp: Record<string, FollowUpItemContent>
}

/** ui keys used only by the Follow-Up screens (stage 1 falls back to the app's own Có/Không labels). */
const NOT_NEEDED_FOR_STAGE1_UI = new Set(['ui.yes', 'ui.no', 'ui.maybe', 'ui.maybePrompt', 'ui.mostOftenPrompt', 'ui.otherDescribe', 'ui.followUpInstructions'])

function notNeededForStage1(at: string): boolean {
  return at.startsWith('followUp.') || NOT_NEEDED_FOR_STAGE1_UI.has(at)
}

const METADATA_TEXT_KEYS = ['contentVersion', 'locale', 'licenseRef', 'translationSource', 'copyrightNotice'] as const
const CONTENT_VERSION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/
const LOCALE_PATTERN = /^[a-z]{2}(?:-[A-Z]{2})?$/

function nodeTemplate(node: FollowUpNode): NodeContent | null {
  switch (node.type) {
    case 'PROMPT':
      return { text: '', note: '' }
    case 'YES_NO':
    case 'MOST_OFTEN':
      return { text: '' }
    case 'CHECKLIST':
      return { stem: '', examples: Object.fromEntries(node.examples.map((e) => [e.id, ''])) }
    case 'CHOICE':
      return { text: '', options: Object.fromEntries(node.options.map((o) => [o.id, ''])) }
  }
}

function nodesTemplate(nodes: Record<string, FollowUpNode>): Record<string, NodeContent> {
  const out: Record<string, NodeContent> = {}
  for (const [id, node] of Object.entries(nodes)) out[id] = nodeTemplate(node)!
  return out
}

function followUpTemplate(f: FollowUpItemStructure): FollowUpItemContent {
  const item: FollowUpItemContent = { header: '', recap: '', nodes: nodesTemplate(f.nodes) }
  if (f.supplementary) item.supplementary = nodesTemplate(f.supplementary.nodes)
  if (f.preambles.length > 0) item.preambles = Object.fromEntries(f.preambles.map((p) => [p.id, '']))
  return item
}

/** Every key of a content file, all texts empty; the structural metadata is filled in. */
export function buildContentTemplate(): McHatContentFile {
  return {
    instrument: 'MCHAT_RF',
    structureVersion: STRUCTURE_VERSION,
    structureHash: structureHash(),
    contentVersion: '',
    locale: 'vi',
    licenseRef: '',
    translationSource: '',
    copyrightNotice: '',
    ui: Object.fromEntries(UI_KEYS.map((k) => [k, ''])) as Record<UiKey, string>,
    stage1: Object.fromEntries(MCHAT_RF_STRUCTURE.stage1.map((s) => [String(s.number), { text: '', examples: '' }])),
    followUp: Object.fromEntries(MCHAT_RF_STRUCTURE.followUp.map((f) => [String(f.item), followUpTemplate(f)])),
  }
}

/**
 * Key paths whose text may stay empty: an official item without examples, and
 * every prompt's `note` (not every official page has an interviewer note; the
 * key stays in the template so the team fills it wherever the page has one).
 */
function optionalTextPaths(): Set<string> {
  const optional = new Set<string>()
  for (const s of MCHAT_RF_STRUCTURE.stage1) if (!s.hasExamples) optional.add(`stage1.${s.number}.examples`)
  for (const f of MCHAT_RF_STRUCTURE.followUp) {
    for (const [group, nodes] of [['nodes', f.nodes], ['supplementary', f.supplementary?.nodes ?? {}]] as const) {
      for (const [id, node] of Object.entries(nodes)) {
        if (node.type === 'PROMPT') optional.add(`followUp.${f.item}.${group}.${id}.note`)
      }
    }
  }
  return optional
}

/** The authors' copyright line must be part of `copyrightNotice` (a translator credit alone is not enough). */
export const COPYRIGHT_AUTHOR_MARK = 'Robins'

export type ContentValidation = {
  ok: boolean
  /** Key paths and reasons only, never text. Structural problems first; empty fields are summarised. */
  errors: string[]
  structuralErrorCount: number
  emptyCount: number
  /** No structural error, and every empty text belongs to the Follow-Up only. */
  stage1Ok: boolean
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

/** Exact key set of the template, non-empty texts, metadata that matches this structure. */
export function validateContent(json: unknown): ContentValidation {
  const structural: string[] = []
  const empty: string[] = []
  const optional = optionalTextPaths()

  const walk = (expected: unknown, actual: unknown, at: string) => {
    if (typeof expected === 'string') {
      if (typeof actual !== 'string') structural.push(`${at}: must be a string`)
      else if (actual.length > TEXT_MAX_LENGTH) structural.push(`${at}: longer than ${TEXT_MAX_LENGTH} characters`)
      else if (actual.trim() === '' && !optional.has(at)) empty.push(at)
      return
    }
    if (!isPlainObject(actual)) {
      structural.push(`${at || '(root)'}: must be an object`)
      return
    }
    const exp = expected as Record<string, unknown>
    for (const key of Object.keys(exp)) {
      const child = at ? `${at}.${key}` : key
      if (!(key in actual)) structural.push(`${child}: missing`)
      else walk(exp[key], actual[key], child)
    }
    for (const key of Object.keys(actual)) {
      if (!(key in exp)) structural.push(`${at ? `${at}.${key}` : key}: unexpected key`)
    }
  }

  walk(buildContentTemplate(), json, '')

  if (isPlainObject(json)) {
    if (json.instrument !== 'MCHAT_RF') structural.push('instrument: must be "MCHAT_RF"')
    if (json.structureVersion !== STRUCTURE_VERSION) {
      structural.push(`structureVersion: must be "${STRUCTURE_VERSION}"`)
    }
    if (json.structureHash !== structureHash()) {
      structural.push(`structureHash: does not match this version of the app (expected "${structureHash()}")`)
    }
    const version = json.contentVersion
    if (typeof version === 'string' && version.trim() !== '' && !CONTENT_VERSION_PATTERN.test(version)) {
      structural.push('contentVersion: use letters, digits, ".", "_" or "-" (max 64)')
    }
    const locale = json.locale
    if (typeof locale === 'string' && locale.trim() !== '' && !LOCALE_PATTERN.test(locale)) {
      structural.push('locale: expected a language code such as "vi"')
    }
    const notice = json.copyrightNotice
    if (typeof notice === 'string' && notice.trim() !== '' && !notice.includes(COPYRIGHT_AUTHOR_MARK)) {
      structural.push(`copyrightNotice: must contain the authors' copyright line (${COPYRIGHT_AUTHOR_MARK} et al.)`)
    }
  }

  const errors = structural.slice(0, MAX_LISTED_STRUCTURAL)
  if (structural.length > MAX_LISTED_STRUCTURAL) {
    errors.push(`… ${structural.length - MAX_LISTED_STRUCTURAL} more structural errors`)
  }
  for (const at of empty.slice(0, MAX_LISTED_EMPTY)) errors.push(`${at}: empty`)
  if (empty.length > MAX_LISTED_EMPTY) errors.push(`… ${empty.length - MAX_LISTED_EMPTY} more empty texts`)

  return {
    ok: structural.length === 0 && empty.length === 0,
    errors,
    structuralErrorCount: structural.length,
    emptyCount: empty.length,
    stage1Ok: structural.length === 0 && empty.every(notNeededForStage1),
  }
}

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

export type ContentState = 'missing' | 'invalid' | 'ready'

export type ContentStatus = {
  state: ContentState
  /** Stage 1 (items, instructions, metadata) is complete; true whenever state is "ready". */
  stage1Ready: boolean
  /** Absolute path that was checked. */
  path: string
  errors: string[]
  contentVersion: string | null
  licenseRef: string | null
  translationSource: string | null
  /** The hash a content file for this version of the app must carry. */
  structureHash: string
  structureVersion: string
}

/** MCHAT_CONTENT_PATH is relative to the backend folder (process.cwd()) unless absolute. */
export function resolveContentPath(configured: string | undefined, cwd: string = process.cwd()): string {
  return path.resolve(cwd, configured && configured.trim() !== '' ? configured : DEFAULT_CONTENT_PATH)
}

type CacheEntry = { path: string; mtimeMs: number; size: number; status: ContentStatus; content: McHatContentFile | null }
let cache: CacheEntry | null = null

function metadataString(json: unknown, key: string): string | null {
  if (!isPlainObject(json)) return null
  const value = json[key]
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null
}

function status(absPath: string, state: ContentState, errors: string[], json: unknown = null, stage1Ready = state === 'ready'): ContentStatus {
  return {
    state,
    stage1Ready,
    path: absPath,
    errors,
    contentVersion: metadataString(json, 'contentVersion'),
    licenseRef: metadataString(json, 'licenseRef'),
    translationSource: metadataString(json, 'translationSource'),
    structureHash: structureHash(),
    structureVersion: STRUCTURE_VERSION,
  }
}

function readContent(absPath: string): { status: ContentStatus; content: McHatContentFile | null; mtimeMs: number; size: number } {
  let stat: fs.Stats
  try {
    stat = fs.statSync(absPath)
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    const state: ContentState = code === 'ENOENT' || code === 'ENOTDIR' ? 'missing' : 'invalid'
    return { status: status(absPath, state, state === 'missing' ? [] : ['file cannot be read']), content: null, mtimeMs: -1, size: -1 }
  }
  if (cache && cache.path === absPath && cache.mtimeMs === stat.mtimeMs && cache.size === stat.size) {
    return { status: cache.status, content: cache.content, mtimeMs: stat.mtimeMs, size: stat.size }
  }
  const done = (s: ContentStatus, content: McHatContentFile | null) => ({ status: s, content, mtimeMs: stat.mtimeMs, size: stat.size })

  if (!stat.isFile()) return done(status(absPath, 'invalid', ['not a file']), null)
  if (stat.size > FILE_MAX_BYTES) return done(status(absPath, 'invalid', ['file is too large']), null)

  let json: unknown
  try {
    const raw = fs.readFileSync(absPath, 'utf8').replace(/^\uFEFF/, '')
    json = JSON.parse(raw)
  } catch {
    // JSON.parse messages quote the file, so they are never passed on.
    return done(status(absPath, 'invalid', ['file is not valid JSON (UTF-8)']), null)
  }

  const validation = validateContent(json)
  if (!validation.ok) {
    return validation.stage1Ok
      ? done(status(absPath, 'invalid', validation.errors, json, true), json as McHatContentFile)
      : done(status(absPath, 'invalid', validation.errors, json), null)
  }
  return done(status(absPath, 'ready', [], json), json as McHatContentFile)
}

function load(absPath: string): CacheEntry {
  const result = readContent(absPath)
  const entry: CacheEntry = { path: absPath, ...result }
  // Only an existing file is cached (keyed by mtime + size); a missing file is re-checked every time.
  if (result.mtimeMs >= 0) cache = entry
  return entry
}

/** missing | invalid (with key-path errors) | ready; re-read when the file changes. */
export function getContentStatus(absPath: string): ContentStatus {
  return load(absPath).status
}

/** The parsed file when ready (stage 1 + Follow-Up), else null. */
export function getReadyContent(absPath: string): McHatContentFile | null {
  const entry = load(absPath)
  return entry.status.state === 'ready' ? entry.content : null
}

/** The parsed file when at least stage 1 is complete, else null. Its Follow-Up texts may be empty. */
export function getStage1Content(absPath: string): McHatContentFile | null {
  const entry = load(absPath)
  return entry.status.stage1Ready ? entry.content : null
}

/** Value stored on an IN_APP response: "<contentVersion>@<structureHash>". */
export function storedContentVersion(content: McHatContentFile): string {
  return `${content.contentVersion}@${structureHash()}`
}

/** Test helper: forget the cached file. */
export function clearContentCache(): void {
  cache = null
}
