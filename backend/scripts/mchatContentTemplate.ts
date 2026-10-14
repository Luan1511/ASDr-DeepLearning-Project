/**
 * Writes content/mchat-rf.template.json: every key of the M-CHAT-R/F content
 * file (ids of lib/questionnaires/mchatRfStructure.ts) with empty texts, plus
 * the structureVersion / structureHash this version of the app expects.
 * The template holds no wording and is the only content file kept in git.
 *
 *   npm run questionnaires:content-template
 *
 * Copy it to content/mchat-rf.vi.json and fill it in (content/README.md).
 */
import fs from 'fs'
import path from 'path'
import { buildContentTemplate } from '../src/lib/questionnaires/mchatContent'

const target = path.resolve(__dirname, '..', 'content', 'mchat-rf.template.json')
fs.mkdirSync(path.dirname(target), { recursive: true })
const template = buildContentTemplate()
fs.writeFileSync(target, `${JSON.stringify(template, null, 2)}\n`, 'utf8')
// eslint-disable-next-line no-console
console.log(`Wrote ${path.relative(process.cwd(), target)} (structure ${template.structureVersion}, hash ${template.structureHash})`)
