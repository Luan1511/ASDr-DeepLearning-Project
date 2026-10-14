import { useEffect, useState } from 'react'
import { api } from './api'
import { fetchQuestionnaires } from './questionnaires'

const TTL_MS = 60_000

let cache: { key: string; at: number; promise: Promise<boolean> } | null = null

function authKey(): string {
  const header = api.defaults.headers.common.Authorization
  return typeof header === 'string' ? header : ''
}

/** Whether parent questionnaires are switched on (MCHAT_MODE ≠ off); false while loading or on error. */
export function loadQuestionnairesEnabled(): Promise<boolean> {
  const key = authKey()
  if (cache && cache.key === key && Date.now() - cache.at < TTL_MS) return cache.promise
  const promise = fetchQuestionnaires()
    .then((q) => q.enabled)
    .catch(() => false)
  cache = { key, at: Date.now(), promise }
  return promise
}

export function useQuestionnairesEnabled(): boolean {
  const [enabled, setEnabled] = useState(false)
  useEffect(() => {
    let stale = false
    loadQuestionnairesEnabled().then((value) => !stale && setEnabled(value))
    return () => {
      stale = true
    }
  }, [])
  return enabled
}
