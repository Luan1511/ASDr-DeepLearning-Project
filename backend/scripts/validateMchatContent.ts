/**
 * Checks an M-CHAT-R/F content file without starting the backend and without
 * a database. Prints the state and key-path errors only, never the text.
 *
 *   npm run questionnaires:validate-content                       # MCHAT_CONTENT_PATH or content/mchat-rf.vi.json
 *   npm run questionnaires:validate-content -- path/to/file.json
 *
 * Exit code 0 when the file is ready, 1 otherwise.
 */
import path from 'path'
import { getContentStatus, resolveContentPath } from '../src/lib/questionnaires/mchatContent'

const backendDir = path.resolve(__dirname, '..')
const argument = process.argv.slice(2).find((a) => !a.startsWith('-'))
const target = argument
  ? path.resolve(process.cwd(), argument)
  : resolveContentPath(process.env.MCHAT_CONTENT_PATH, backendDir)

const status = getContentStatus(target)

/* eslint-disable no-console */
console.log(`File:              ${path.relative(process.cwd(), status.path) || status.path}`)
console.log(`State:             ${status.state}`)
console.log(`Stage 1 in app:    ${status.stage1Ready ? 'ready (Follow-Up in app needs the whole file)' : 'not ready'}`)
console.log(`Structure:         ${status.structureVersion} (hash ${status.structureHash})`)
console.log(`Content version:   ${status.contentVersion ?? '-'}`)
console.log(`License ref:       ${status.licenseRef ?? '-'}`)
console.log(`Translation:       ${status.translationSource ?? '-'}`)
if (status.state === 'missing') {
  console.log('\nNo file. Create it from content/mchat-rf.template.json (see content/README.md).')
}
if (status.errors.length > 0) {
  console.log(`\nErrors (${status.errors.length} listed):`)
  for (const error of status.errors) console.log(`  - ${error}`)
}
/* eslint-enable no-console */
process.exitCode = status.state === 'ready' ? 0 : 1
