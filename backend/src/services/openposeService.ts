import fs from 'fs'
import path from 'path'
import { env } from '../lib/env'
import { Semaphore } from '../lib/semaphore'

export function getOpenPoseBaseUrl(): string {
  // EXTRACT_API_URL may be a full endpoint (…/pipeline/asd); only the origin is used.
  return new URL(env.OPENPOSE_SERVER_URL || env.EXTRACT_API_URL).origin
}

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

export type OpenPosePrediction = {
  file: string
  T_in: number
  J: number
  p_typical: number
  p_asd: number
  logit_typical?: number
  logit_asd?: number
  pred_argmax?: number
  label_threshold?: number
  threshold?: number
  temperature?: number
  label_name?: string
  // Present on ML servers that load ASD_Model/calibration.json.
  high_risk_threshold?: number
  calibrated?: boolean
  model?: {
    checkpoint?: string
    sha256?: string
    num_joints?: number
  }
}

/** Probed by the ML server with OpenCV (newer servers only). */
export type OpenPoseVideoInfo = {
  fps?: number | null
  width?: number | null
  height?: number | null
  frame_count?: number | null
  duration_sec?: number | null
}

export type OpenPoseSubjectMetadata = {
  subject_id: string
  filename: string
  created_at: string
  keypoint_format: string
  num_frames: number
  status: string
  has_prediction: boolean
  prediction_updated_at?: string
  video?: OpenPoseVideoInfo
  video_retention?: string
}

export type OpenPoseKeypointFrame = {
  frame_index: number
  people: Array<{
    person_id: number
    body25: Array<{
      id: number
      x: number
      y: number
      confidence: number
    }>
  }>
}

export type OpenPosePipelineResponse = {
  subject_id: string
  filename: string
  num_frames: number
  keypoint_format: string
  prediction: OpenPosePrediction
  video?: OpenPoseVideoInfo
  saved?: {
    subject_dir?: string
    input_video?: string
    openpose_json_dir?: string
    keypoints_path?: string
    prediction_path?: string
    metadata_path?: string
  }
  frames?: OpenPoseKeypointFrame[]
}

export type OpenPoseExtractResponse = {
  subject_id: string
  filename: string
  num_frames: number
  keypoint_format: string
  video?: OpenPoseVideoInfo
  saved?: {
    subject_dir?: string
    input_video?: string
    openpose_json_dir?: string
    keypoints_path?: string
    metadata_path?: string
  }
}

export type OpenPoseSubjectDetail = {
  metadata: OpenPoseSubjectMetadata
  prediction?: {
    subject_id: string
    created_at: string
    prediction: OpenPosePrediction
  }
}

export type OpenPoseKeypointsResponse = {
  subject_id: string
  keypoint_format: string
  num_frames: number
  video?: OpenPoseVideoInfo
  frames: OpenPoseKeypointFrame[]
}

export type OpenPoseSubjectPredictionResponse = {
  subject_id: string
  created_at: string
  prediction: OpenPosePrediction
}

export type OpenPoseHealth = {
  status: string
  version?: string
  model_loaded?: boolean
  calibrated?: boolean
  video_retention?: string
  auth_required?: boolean
}

// OpenPose saturates the GPU; queue heavy calls instead of running them in parallel.
const heavyCallGate = new Semaphore(env.ML_MAX_CONCURRENCY)

async function requestOpenPose<T = any>(
  endpoint: string,
  options: {
    method?: string
    body?: any
    headers?: Record<string, string>
    timeoutMs?: number
  } = {},
): Promise<T> {
  const baseUrl = getOpenPoseBaseUrl()
  const cleanEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`
  const targetUrl = `${baseUrl}${cleanEndpoint}`
  const timeoutMs = options.timeoutMs ?? env.EXTRACT_API_TIMEOUT_MS

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)

  let response: Response
  try {
    response = await fetch(targetUrl, {
      method: options.method || 'GET',
      headers: {
        'ngrok-skip-browser-warning': 'true',
        'User-Agent': 'ASD-Backend/1.0',
        ...(env.OPENPOSE_API_KEY ? { 'X-API-Key': env.OPENPOSE_API_KEY } : {}),
        ...options.headers,
      },
      body: options.body,
      signal: controller.signal,
    })
  } catch (error: any) {
    clearTimeout(timeout)
    if (error?.name === 'AbortError') {
      throw new OpenPoseApiError(
        `OpenPose API timed out after ${Math.round(timeoutMs / 1000)} seconds: ${targetUrl}`,
        'timeout',
      )
    }
    const message = error instanceof Error ? error.message : String(error)
    const cause = error instanceof Error && 'cause' in error ? (error as any).cause : undefined
    const causeMessage = cause instanceof Error ? cause.message : cause ? String(cause) : ''
    throw new OpenPoseApiError(
      `OpenPose API connection failed: ${causeMessage ? `${message} (${causeMessage})` : message}`,
      'network',
    )
  }

  let text: string
  try {
    text = await response.text()
  } catch (error: any) {
    throw new OpenPoseApiError(
      error?.name === 'AbortError'
        ? `OpenPose API timed out after ${Math.round(timeoutMs / 1000)} seconds: ${targetUrl}`
        : `OpenPose API connection failed while reading the response: ${error?.message ?? error}`,
      error?.name === 'AbortError' ? 'timeout' : 'network',
    )
  } finally {
    clearTimeout(timeout)
  }

  if (!response.ok) {
    const isHtml = text.includes('<!DOCTYPE') || text.includes('<html')
    if (isHtml) {
      throw new OpenPoseApiError(
        `OpenPose API returned HTML page (status ${response.status}). Check if ngrok tunnel is active and API is running at ${baseUrl}`,
        'html',
        response.status,
      )
    }
    let errorDetail = text
    try {
      const parsed = JSON.parse(text)
      const detail = parsed.detail ?? parsed.message ?? parsed.error
      errorDetail = typeof detail === 'string' ? detail : JSON.stringify(detail ?? parsed)
    } catch {
      // ignore
    }
    throw new OpenPoseApiError(
      `OpenPose API failed: ${response.status} ${response.statusText} - ${errorDetail}`,
      'http',
      response.status,
      errorDetail,
    )
  }

  try {
    return (text ? JSON.parse(text) : {}) as T
  } catch {
    throw new OpenPoseApiError(`OpenPose API returned invalid JSON: ${text.slice(0, 500)}`, 'invalid_json')
  }
}

async function prepareVideoBlob(input: {
  filePath?: string
  buffer?: Buffer
  mimeType?: string
}): Promise<Blob> {
  const mimeType = input.mimeType || 'video/mp4'
  if (input.filePath) {
    const resolvedPath = path.resolve(process.cwd(), input.filePath)
    if (!fs.existsSync(resolvedPath)) {
      throw new Error(`Video file does not exist at path: ${resolvedPath}`)
    }
    return await fs.openAsBlob(resolvedPath, { type: mimeType })
  }
  if (input.buffer) {
    return new Blob([input.buffer as any], {
      type: mimeType,
    })
  }
  throw new Error('Either filePath or buffer must be provided')
}

function subjectPath(subjectId: string, suffix = '') {
  return `/subjects/${encodeURIComponent(subjectId)}${suffix}`
}

export class OpenPoseService {
  /**
   * Health / Root
   */
  async checkHealth(): Promise<{ message: string; routes: string[] }> {
    return requestOpenPose('/', { timeoutMs: 15_000 })
  }

  /**
   * GET /health — only on updated ML servers; null when the server predates it.
   */
  async getHealth(): Promise<OpenPoseHealth | null> {
    try {
      return await requestOpenPose<OpenPoseHealth>('/health', { timeoutMs: 15_000 })
    } catch (error) {
      if (error instanceof OpenPoseApiError && error.status === 404) return null
      throw error
    }
  }

  /**
   * POST /pipeline/asd
   */
  async runPipelineAsd(params: {
    filePath?: string
    buffer?: Buffer
    originalFilename?: string
    mimeType?: string
    subjectId?: string
    threshold?: number
    temperature?: number
    returnKeypoints?: boolean
  }): Promise<OpenPosePipelineResponse> {
    const blob = await prepareVideoBlob({
      filePath: params.filePath,
      buffer: params.buffer,
      mimeType: params.mimeType,
    })

    const formData = new FormData()
    formData.append('video', blob, params.originalFilename || 'input.mp4')

    const searchParams = new URLSearchParams()
    if (params.subjectId) searchParams.append('subject_id', params.subjectId)
    if (params.threshold !== undefined) searchParams.append('threshold', String(params.threshold))
    if (params.temperature !== undefined) searchParams.append('temperature', String(params.temperature))
    if (params.returnKeypoints) searchParams.append('return_keypoints', 'true')

    const qs = searchParams.toString() ? `?${searchParams.toString()}` : ''
    return heavyCallGate.run(() =>
      requestOpenPose<OpenPosePipelineResponse>(`/pipeline/asd${qs}`, {
        method: 'POST',
        body: formData,
      }),
    )
  }

  /**
   * POST /subjects/extract
   */
  async extractSubject(params: {
    filePath?: string
    buffer?: Buffer
    originalFilename?: string
    mimeType?: string
    subjectId?: string
  }): Promise<OpenPoseExtractResponse> {
    const blob = await prepareVideoBlob({
      filePath: params.filePath,
      buffer: params.buffer,
      mimeType: params.mimeType,
    })

    const formData = new FormData()
    formData.append('video', blob, params.originalFilename || 'input.mp4')

    const searchParams = new URLSearchParams()
    if (params.subjectId) searchParams.append('subject_id', params.subjectId)

    const qs = searchParams.toString() ? `?${searchParams.toString()}` : ''
    return heavyCallGate.run(() =>
      requestOpenPose<OpenPoseExtractResponse>(`/subjects/extract${qs}`, {
        method: 'POST',
        body: formData,
      }),
    )
  }

  /**
   * POST /subjects/{subject_id}/predict
   */
  async predictSubject(
    subjectId: string,
    options: {
      threshold?: number
      temperature?: number
    } = {},
  ): Promise<OpenPoseSubjectPredictionResponse> {
    const searchParams = new URLSearchParams()
    if (options.threshold !== undefined) searchParams.append('threshold', String(options.threshold))
    if (options.temperature !== undefined) searchParams.append('temperature', String(options.temperature))

    const qs = searchParams.toString() ? `?${searchParams.toString()}` : ''
    return heavyCallGate.run(() =>
      requestOpenPose<OpenPoseSubjectPredictionResponse>(subjectPath(subjectId, `/predict${qs}`), {
        method: 'POST',
      }),
    )
  }

  /**
   * GET /subjects
   */
  async listSubjects(): Promise<{ total: number; subjects: OpenPoseSubjectMetadata[] }> {
    return requestOpenPose<{ total: number; subjects: OpenPoseSubjectMetadata[] }>('/subjects', {
      timeoutMs: 60_000,
    })
  }

  /**
   * GET /subjects/{subject_id}
   */
  async getSubject(subjectId: string): Promise<OpenPoseSubjectDetail> {
    return requestOpenPose<OpenPoseSubjectDetail>(subjectPath(subjectId), { timeoutMs: 60_000 })
  }

  /**
   * GET /subjects/{subject_id}/keypoints
   */
  async getSubjectKeypoints(subjectId: string): Promise<OpenPoseKeypointsResponse> {
    return requestOpenPose<OpenPoseKeypointsResponse>(subjectPath(subjectId, '/keypoints'), {
      timeoutMs: 5 * 60_000,
    })
  }

  /**
   * GET /subjects/{subject_id}/prediction
   */
  async getSubjectPrediction(subjectId: string): Promise<OpenPoseSubjectPredictionResponse> {
    return requestOpenPose<OpenPoseSubjectPredictionResponse>(subjectPath(subjectId, '/prediction'), {
      timeoutMs: 60_000,
    })
  }

  /**
   * DELETE /subjects/{subject_id}
   */
  async deleteSubject(subjectId: string): Promise<{ subject_id: string; deleted: boolean }> {
    return requestOpenPose<{ subject_id: string; deleted: boolean }>(subjectPath(subjectId), {
      method: 'DELETE',
      timeoutMs: 60_000,
    })
  }
}

export const openposeService = new OpenPoseService()
