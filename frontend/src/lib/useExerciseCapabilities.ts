import { useEffect, useState } from 'react'
import { api } from './api'
import { fetchExerciseCapabilities } from './exercises'
import type { ExerciseCapabilitiesDto } from './exerciseTypes'

const TTL_MS = 60_000

// Capabilities depend on the signed-in user's role, so the cache is keyed by token.
let cache: { key: string; at: number; promise: Promise<ExerciseCapabilitiesDto | null> } | null = null

function authKey(): string {
  const header = api.defaults.headers.common.Authorization
  return typeof header === 'string' ? header : ''
}

export function loadExerciseCapabilities(force = false): Promise<ExerciseCapabilitiesDto | null> {
  const key = authKey()
  if (!force && cache && cache.key === key && Date.now() - cache.at < TTL_MS) return cache.promise
  // An older backend (no exercise routes) or an error simply hides the feature.
  const promise = fetchExerciseCapabilities().catch(() => null)
  cache = { key, at: Date.now(), promise }
  return promise
}

/** null while loading or when the backend does not offer exercises. */
export function useExerciseCapabilities(): ExerciseCapabilitiesDto | null {
  const [caps, setCaps] = useState<ExerciseCapabilitiesDto | null>(null)
  useEffect(() => {
    let stale = false
    loadExerciseCapabilities().then((value) => !stale && setCaps(value))
    return () => {
      stale = true
    }
  }, [])
  return caps
}
