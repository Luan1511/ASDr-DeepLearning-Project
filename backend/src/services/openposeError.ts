/** Kept apart from openposeService so it can be used without loading env. */
export type OpenPoseErrorKind = 'timeout' | 'network' | 'html' | 'http' | 'invalid_json'

/**
 * Error raised for any failed call to the ML server. `message` keeps the full
 * technical detail for logs and admins; never show it verbatim to parents
 * (it can contain upstream URLs or OpenPose stderr).
 */
export class OpenPoseApiError extends Error {
  constructor(
    message: string,
    readonly kind: OpenPoseErrorKind,
    readonly status?: number,
    readonly detail?: string,
  ) {
    super(message)
    this.name = 'OpenPoseApiError'
  }

  /** Transient failures worth retrying: tunnel/network problems and 5xx. */
  get retryable(): boolean {
    if (this.kind !== 'http') return true
    const status = this.status ?? 0
    return status >= 500 || status === 408 || status === 429
  }
}
