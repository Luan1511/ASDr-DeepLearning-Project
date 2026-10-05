import axios from 'axios'

const apiBaseUrl = import.meta.env.VITE_API_URL ?? 'http://localhost:4000/api'

export const api = axios.create({
  baseURL: apiBaseUrl,
})

export function setAuthToken(token: string | null) {
  if (token) {
    api.defaults.headers.common.Authorization = `Bearer ${token}`
  } else {
    delete api.defaults.headers.common.Authorization
  }
}

let unauthorizedHandler: (() => void) | null = null

/** Called when an authenticated request gets 401 (expired or revoked token). */
export function onUnauthorized(handler: (() => void) | null) {
  unauthorizedHandler = handler
}

api.interceptors.response.use(
  (response) => response,
  (error) => {
    const status = error?.response?.status
    const url: string = error?.config?.url ?? ''
    const headers = error?.config?.headers
    const hadToken = Boolean(headers?.get?.('Authorization') ?? headers?.Authorization)
    if (status === 401 && hadToken && !url.includes('/auth/login')) unauthorizedHandler?.()
    return Promise.reject(error)
  },
)

/** Backend error code (`{ error: 'CODE' }`) of an Axios error, if any. */
export function apiErrorCode(error: unknown): string | undefined {
  if (!axios.isAxiosError(error)) return undefined
  const data = error.response?.data as { error?: unknown } | undefined
  return typeof data?.error === 'string' ? data.error : undefined
}

/** True when the request never got an HTTP response (offline, CORS, server down). */
export function isNetworkError(error: unknown): boolean {
  return axios.isAxiosError(error) && !error.response
}

/**
 * Best-effort error text from an Axios error, including `responseType: 'blob'`
 * requests whose JSON error body arrives as a Blob.
 */
export async function apiErrorMessage(error: unknown, fallback: string): Promise<string> {
  let data: unknown = axios.isAxiosError(error) ? error.response?.data : undefined
  if (data instanceof Blob) {
    try {
      data = JSON.parse(await data.text())
    } catch {
      data = null
    }
  }
  const body = data as { detail?: unknown; message?: unknown; error?: unknown } | null | undefined
  const detail = body?.detail ?? body?.message ?? body?.error
  return typeof detail === 'string' && detail ? detail : fallback
}
