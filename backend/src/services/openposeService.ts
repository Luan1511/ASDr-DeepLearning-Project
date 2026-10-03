import fs from 'fs'
import path from 'path'
import { env } from '../lib/env'

export function getOpenPoseBaseUrl(): string {
  const raw =
    env.OPENPOSE_SERVER_URL ||
    env.EXTRACT_API_URL ||
    'https://obstinate-doubling-directly.ngrok-free.dev'
  try {
    const parsed = new URL(raw)
    return parsed.origin
  } catch {
    return 'https://obstinate-doubling-directly.ngrok-free.dev'
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
}

export type OpenPoseSubjectMetadata = {
  subject_id: string
  filename: string
  created_at: string
  keypoint_format: string
  num_frames: number
  status: string
  has_prediction: boolean
}

export type OpenPosePipelineResponse = {
  subject_id: string
  filename: string
  num_frames: number
  keypoint_format: string
  prediction: OpenPosePrediction
  saved?: {
    subject_dir?: string
    input_video?: string
    openpose_json_dir?: string
    keypoints_path?: string
    prediction_path?: string
    metadata_path?: string
  }
  frames?: any[]
}

export type OpenPoseExtractResponse = {
  subject_id: string
  filename: string
  num_frames: number
  keypoint_format: string
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
  frames: Array<{
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
  }>
}

export type OpenPoseSubjectPredictionResponse = {
  subject_id: string
  created_at: string
  prediction: OpenPosePrediction
}

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
        ...options.headers,
      },
      body: options.body,
      signal: controller.signal,
    })
  } catch (error: any) {
    if (error?.name === 'AbortError') {
      throw new Error(
        `OpenPose API timed out after ${Math.round(timeoutMs / 1000)} seconds: ${targetUrl}`,
      )
    }
    const message = error instanceof Error ? error.message : String(error)
    const cause = error instanceof Error && 'cause' in error ? (error as any).cause : undefined
    const causeMessage = cause instanceof Error ? cause.message : cause ? String(cause) : ''
    throw new Error(
      `OpenPose API connection failed: ${causeMessage ? `${message} (${causeMessage})` : message}`,
    )
  } finally {
    clearTimeout(timeout)
  }

  const text = await response.text()

  if (!response.ok) {
    const isHtml = text.includes('<!DOCTYPE') || text.includes('<html')
    if (isHtml) {
      throw new Error(
        `OpenPose API returned HTML page (status ${response.status}). Check if ngrok tunnel is active and API is running at ${baseUrl}`,
      )
    }
    let errorDetail = text
    try {
      const parsed = JSON.parse(text)
      errorDetail = parsed.detail || parsed.message || parsed.error || JSON.stringify(parsed)
    } catch {
      // ignore
    }
    throw new Error(`OpenPose API failed: ${response.status} ${response.statusText} - ${errorDetail}`)
  }

  try {
    return (text ? JSON.parse(text) : {}) as T
  } catch {
    throw new Error(`OpenPose API returned invalid JSON: ${text.slice(0, 500)}`)
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

export class OpenPoseService {
  /**
   * Health / Root
   */
  async checkHealth(): Promise<{ message: string; routes: string[] }> {
    return requestOpenPose('/')
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
    return requestOpenPose<OpenPosePipelineResponse>(`/pipeline/asd${qs}`, {
      method: 'POST',
      body: formData,
    })
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
    return requestOpenPose<OpenPoseExtractResponse>(`/subjects/extract${qs}`, {
      method: 'POST',
      body: formData,
    })
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
    return requestOpenPose<OpenPoseSubjectPredictionResponse>(
      `/subjects/${encodeURIComponent(subjectId)}/predict${qs}`,
      { method: 'POST' },
    )
  }

  /**
   * GET /subjects
   */
  async listSubjects(): Promise<{ total: number; subjects: OpenPoseSubjectMetadata[] }> {
    return requestOpenPose<{ total: number; subjects: OpenPoseSubjectMetadata[] }>('/subjects')
  }

  /**
   * GET /subjects/{subject_id}
   */
  async getSubject(subjectId: string): Promise<OpenPoseSubjectDetail> {
    return requestOpenPose<OpenPoseSubjectDetail>(`/subjects/${encodeURIComponent(subjectId)}`)
  }

  /**
   * GET /subjects/{subject_id}/keypoints
   */
  async getSubjectKeypoints(subjectId: string): Promise<OpenPoseKeypointsResponse> {
    return requestOpenPose<OpenPoseKeypointsResponse>(
      `/subjects/${encodeURIComponent(subjectId)}/keypoints`,
    )
  }

  /**
   * GET /subjects/{subject_id}/prediction
   */
  async getSubjectPrediction(subjectId: string): Promise<OpenPoseSubjectPredictionResponse> {
    return requestOpenPose<OpenPoseSubjectPredictionResponse>(
      `/subjects/${encodeURIComponent(subjectId)}/prediction`,
    )
  }

  /**
   * DELETE /subjects/{subject_id}
   */
  async deleteSubject(subjectId: string): Promise<{ subject_id: string; deleted: boolean }> {
    return requestOpenPose<{ subject_id: string; deleted: boolean }>(
      `/subjects/${encodeURIComponent(subjectId)}`,
      { method: 'DELETE' },
    )
  }
}

export const openposeService = new OpenPoseService()
