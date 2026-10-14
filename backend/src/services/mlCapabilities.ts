/**
 * What the ML server can do for exercise clips. ML 2.0 answers GET /health and
 * decodes .webm; ML 1.0 (the deployed ngrok build) has no /health and is
 * assumed to reject .webm. An unreachable server is treated like 1.0 so callers
 * fall back to the most conservative format choice.
 */
import { OpenPoseApiError, openposeService } from './openposeService'

export type MlCapabilities = { reachable: boolean; legacy: boolean; acceptsWebm: boolean }

const CACHE_TTL_MS = 60_000
const UNREACHABLE: MlCapabilities = { reachable: false, legacy: true, acceptsWebm: false }

let cache: { value: MlCapabilities; at: number } | null = null
let inFlight: Promise<MlCapabilities> | null = null

async function probe(): Promise<MlCapabilities> {
  try {
    const health = await openposeService.getHealth()
    if (health) return { reachable: true, legacy: false, acceptsWebm: true }
  } catch {
    return UNREACHABLE
  }
  // getHealth() also maps an HTML 404 (offline ngrok tunnel) to null, so make
  // sure an ML 1.0 server is really answering before calling it reachable.
  try {
    await openposeService.checkHealth()
    return { reachable: true, legacy: true, acceptsWebm: false }
  } catch (error) {
    if (error instanceof OpenPoseApiError && error.kind === 'http') {
      // A JSON error from the root route still means a live ML 1.0 server.
      return { reachable: true, legacy: true, acceptsWebm: false }
    }
    return UNREACHABLE
  }
}

/** Cached for 60 s; concurrent callers share one probe. */
export async function getMlCapabilities(options: { force?: boolean } = {}): Promise<MlCapabilities> {
  if (!options.force && cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.value
  if (!inFlight) {
    inFlight = probe()
      .then((value) => {
        cache = { value, at: Date.now() }
        return value
      })
      .finally(() => {
        inFlight = null
      })
  }
  return inFlight
}
