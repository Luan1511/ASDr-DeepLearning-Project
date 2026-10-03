import { RiskLevel, ScreeningStatus } from '@prisma/client'
import fs from 'fs'
import path from 'path'
import { env } from '../lib/env'
import { prisma } from '../lib/prisma'
import { generateMockAiResult, toRiskEnum } from './aiMock'

import {
  OpenPosePipelineResponse,
  getOpenPoseBaseUrl,
  openposeService,
} from './openposeService'

const inFlight = new Map<string, NodeJS.Timeout>()

type ApiPrediction = {
  p_asd?: number
  p_typical?: number
  label_threshold?: number
  threshold?: number
  label_name?: string
}

type ApiResult = {
  subject_id?: string
  num_frames?: number
  risk_level?: 'low' | 'medium' | 'high'
  confidence_score?: number
  behavioral_scores?: {
    eye_contact?: number
    motor_pattern?: number
    response_behavior?: number
    repetitive_behavior?: number
  }
  recommendation?: string
  prediction?: ApiPrediction
  saved?: any
  keypoint_format?: string
}

function clamp01(n: number) {
  return Math.max(0, Math.min(1, n))
}

function riskFromAsdProbability(pAsd: number, threshold = 0.5): RiskLevel {
  if (pAsd >= 0.7) return RiskLevel.HIGH
  if (pAsd >= threshold) return RiskLevel.MEDIUM
  return RiskLevel.LOW
}

function recommendationFor(riskLevel: RiskLevel, pAsd: number) {
  const percent = Math.round(pAsd * 100)
  if (riskLevel === RiskLevel.HIGH) {
    return `Mô hình ghi nhận xác suất ASD khoảng ${percent}%. Nên trao đổi sớm với bác sĩ nhi hoặc chuyên gia phát triển để được đánh giá trực tiếp.`
  }
  if (riskLevel === RiskLevel.MEDIUM) {
    return `Mô hình ghi nhận một số dấu hiệu cần theo dõi, xác suất ASD khoảng ${percent}%. Gia đình nên tiếp tục quan sát và cân nhắc tham vấn chuyên gia nếu còn lo lắng.`
  }
  return `Mô hình ghi nhận xác suất ASD thấp, khoảng ${percent}%. Kết quả chỉ mang tính tham khảo; gia đình vẫn nên tiếp tục theo dõi sự phát triển của trẻ.`
}

function normalizeApiResult(result: ApiResult | OpenPosePipelineResponse) {
  if (
    'risk_level' in result &&
    result.risk_level &&
    result.confidence_score !== undefined &&
    result.behavioral_scores
  ) {
    const riskLevel = toRiskEnum(result.risk_level)
    return {
      riskLevel,
      confidenceScore: clamp01(result.confidence_score),
      eyeContactScore: clamp01(result.behavioral_scores.eye_contact ?? 0),
      motorPatternScore: clamp01(result.behavioral_scores.motor_pattern ?? 0),
      responseBehaviorScore: clamp01(result.behavioral_scores.response_behavior ?? 0),
      repetitiveBehaviorScore: clamp01(result.behavioral_scores.repetitive_behavior ?? 0),
      recommendation:
        result.recommendation ?? recommendationFor(riskLevel, 1 - result.confidence_score),
    }
  }

  const prediction = result.prediction
  const pAsd = clamp01(Number(prediction?.p_asd ?? 0))
  const pTypical = clamp01(Number(prediction?.p_typical ?? 1 - pAsd))
  const threshold = Number(prediction?.threshold ?? 0.5)
  const riskLevel = riskFromAsdProbability(pAsd, threshold)
  const confidenceScore = clamp01(Math.max(pAsd, pTypical))

  return {
    riskLevel,
    confidenceScore,
    eyeContactScore: pTypical,
    motorPatternScore: pTypical,
    responseBehaviorScore: pTypical,
    repetitiveBehaviorScore: pAsd,
    recommendation: ('recommendation' in result ? result.recommendation : undefined) ?? recommendationFor(riskLevel, pAsd),
  }
}

async function callPredictionApi(videoId: string) {
  const video = await prisma.videoUpload.findUnique({ where: { id: videoId } })
  if (!video) throw new Error(`Video upload not found: ${videoId}`)

  const fullPath = path.resolve(process.cwd(), video.filePath)
  if (!fs.existsSync(fullPath)) {
    throw new Error(`Video file does not exist at path: ${fullPath}`)
  }

  const json = await openposeService.runPipelineAsd({
    filePath: fullPath,
    originalFilename: video.originalFilename,
    mimeType: video.mimeType,
    subjectId: video.id,
    threshold: 0.5,
    temperature: 1.0,
    returnKeypoints: false,
  })

  return {
    apiUrl: `${getOpenPoseBaseUrl()}/pipeline/asd`,
    json,
  }
}

async function createMockResult(videoId: string) {
  const mock = generateMockAiResult()
  const riskLevel: RiskLevel = toRiskEnum(mock.risk_level)

  await prisma.screeningResult.create({
    data: {
      videoId,
      riskLevel,
      confidenceScore: mock.confidence_score,
      eyeContactScore: mock.behavioral_scores.eye_contact,
      motorPatternScore: mock.behavioral_scores.motor_pattern,
      responseBehaviorScore: mock.behavioral_scores.response_behavior,
      repetitiveBehaviorScore: mock.behavioral_scores.repetitive_behavior,
      recommendation: mock.recommendation,
      rawAiResponse: { ...mock, provider: 'mock', generated_at: new Date().toISOString() },
    },
  })
}

async function createApiResult(videoId: string) {
  const { apiUrl, json } = await callPredictionApi(videoId)
  const normalized = normalizeApiResult(json)

  await prisma.screeningResult.create({
    data: {
      videoId,
      riskLevel: normalized.riskLevel,
      confidenceScore: normalized.confidenceScore,
      eyeContactScore: normalized.eyeContactScore,
      motorPatternScore: normalized.motorPatternScore,
      responseBehaviorScore: normalized.responseBehaviorScore,
      repetitiveBehaviorScore: normalized.repetitiveBehaviorScore,
      recommendation: normalized.recommendation,
      rawAiResponse: {
        provider: 'openpose-stgcn',
        apiUrl,
        subjectId: json.subject_id || videoId,
        numFrames: json.num_frames,
        keypointFormat: json.keypoint_format,
        saved: json.saved,
        generated_at: new Date().toISOString(),
        response: json,
      },
    },
  })
}

export async function enqueueScreeningProcessing(videoId: string, delayMs = 500) {
  if (inFlight.has(videoId)) return

  await prisma.videoUpload.update({
    where: { id: videoId },
    data: { status: ScreeningStatus.PROCESSING, errorMessage: null },
  })

  const handle = setTimeout(async () => {
    try {
      const existing = await prisma.screeningResult.findUnique({ where: { videoId } })
      if (existing) {
        await prisma.videoUpload.update({ where: { id: videoId }, data: { status: ScreeningStatus.COMPLETED } })
        return
      }

      if (env.BYPASS_EXTRACT_API) {
        await createMockResult(videoId)
      } else {
        await createApiResult(videoId)
      }

      await prisma.videoUpload.update({
        where: { id: videoId },
        data: { status: ScreeningStatus.COMPLETED },
      })
    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : String(e)
      await prisma.videoUpload.update({
        where: { id: videoId },
        data: { status: ScreeningStatus.FAILED, errorMessage },
      })
      // eslint-disable-next-line no-console
      console.error(`Screening processing failed for video ${videoId}:`, e)
    } finally {
      const timeout = inFlight.get(videoId)
      if (timeout) clearTimeout(timeout)
      inFlight.delete(videoId)
    }
  }, delayMs)

  inFlight.set(videoId, handle)
}
