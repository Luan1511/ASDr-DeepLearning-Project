import { RiskLevel, ScreeningStatus } from '@prisma/client'
import fs from 'fs'
import path from 'path'
import { prisma } from '../lib/prisma'
import { env } from '../lib/env'
import { generateMockAiResult, toRiskEnum } from './aiMock'

const inFlight = new Map<string, NodeJS.Timeout>()

/**
 * Calls the Llama API to generate a personalized recommendation based on prediction output.
 * Falls back to a static recommendation if the LLM is unavailable.
 */
async function callLlmForRecommendation(opts: {
  childName: string
  childAge: number | null
  riskLevel: RiskLevel
  pAsd: number
  pTypical: number
  modelName?: string
}): Promise<string> {
  const { childName, childAge, riskLevel, pAsd, pTypical, modelName = 'asd_lora_2' } = opts

  const pAsdPct = (pAsd * 100).toFixed(1)
  const pTypicalPct = (pTypical * 100).toFixed(1)
  const ageText = childAge ? `${childAge} tuổi` : 'không rõ tuổi'
  const riskText = riskLevel === RiskLevel.HIGH ? 'Nguy cơ cao ASD' : riskLevel === RiskLevel.MEDIUM ? 'Nguy cơ trung bình' : 'Phát triển điển hình'

  const question = `Kết quả sàng lọc ASD cho bé ${childName} (${ageText}):
- Nhãn dự đoán: ${riskText}
- Xác suất ASD: ${pAsdPct}%
- Xác suất Điển hình: ${pTypicalPct}%

Dựa trên các chỉ số trên, hãy đưa ra lời khuyên cụ thể, thực tế và đầy đủ cho phụ huynh. Nếu nguy cơ cao, hãy hướng dẫn các bước tiếp theo cần làm. Trả lời bằng tiếng Việt, không quá 3 đoạn.`

  try {
    const url = new URL(`/chat/${modelName}`, env.CHAT_API_BASE_URL).toString()
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        question,
        context: '',
        max_new_tokens: 512,
        temperature: 0.5,
      }),
    })

    if (!response.ok) {
      throw new Error(`LLM API responded with status ${response.status}`)
    }

    const data = (await response.json()) as any
    if (data?.answer) {
      return data.answer
    }
    throw new Error('No answer in LLM response')
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('LLM recommendation generation failed, using static fallback:', err)
    if (riskLevel === RiskLevel.HIGH) {
      return 'Kết quả cho thấy có khả năng cao trẻ mang dấu hiệu ASD. Xin vui lòng tham khảo ý kiến chuyên gia y tế sớm nhất có thể.'
    }
    return 'Kết quả hiện tại cho thấy trẻ có xu hướng phát triển điển hình. Dù vậy, kết quả chỉ mang tính tham khảo và không thay thế chẩn đoán y khoa.'
  }
}

export async function enqueueMockProcessing(videoId: string, delayMs = 2000) {
  if (inFlight.has(videoId)) return

  await prisma.videoUpload.update({
    where: { id: videoId },
    data: { status: ScreeningStatus.PROCESSING },
  })

  const handle = setTimeout(async () => {
    try {
      const existing = await prisma.screeningResult.findUnique({ where: { videoId } })
      if (existing) {
        await prisma.videoUpload.update({ where: { id: videoId }, data: { status: ScreeningStatus.COMPLETED } })
        return
      }

      const video = await prisma.videoUpload.findUnique({
        where: { id: videoId },
        include: { child: true },
      })
      if (!video) {
        throw new Error(`Video upload not found: ${videoId}`)
      }

      let keypoints: any = null
      let apiPrediction: any = null

      if (!env.BYPASS_EXTRACT_API) {
        // eslint-disable-next-line no-console
        console.log(`Sending video ${video.storedFilename} to keypoint extraction API...`)

        const fullPath = path.resolve(process.cwd(), video.filePath)
        if (!fs.existsSync(fullPath)) {
          throw new Error(`Video file does not exist at path: ${fullPath}`)
        }

        const fileBuffer = fs.readFileSync(fullPath)
        const blob = new Blob([fileBuffer], { type: video.mimeType })
        const formData = new FormData()
        formData.append('video', blob, video.originalFilename)

        const response = await fetch(env.EXTRACT_API_URL, {
          method: 'POST',
          body: formData,
        })

        if (!response.ok) {
          const errText = await response.text()
          throw new Error(`API extraction failed: Status ${response.status} - ${errText}`)
        }

        const resultJson = (await response.json()) as any

        if (resultJson && typeof resultJson === 'object' && ('detail' in resultJson || 'error' in resultJson)) {
          const detailMsg = typeof resultJson.detail === 'string' ? resultJson.detail : JSON.stringify(resultJson.detail || resultJson.error)
          throw new Error(`API returned error details:\n${detailMsg}`)
        }

        keypoints = resultJson.frames || resultJson
        apiPrediction = resultJson.prediction || resultJson
        // eslint-disable-next-line no-console
        console.log(`Keypoint extraction succeeded for video ${videoId}`, apiPrediction)
      } else {
        // eslint-disable-next-line no-console
        console.log(`Bypassing keypoint extraction API for video ${videoId} (Mock Mode)`)
      }

      const mock = generateMockAiResult()
      let riskLevel: RiskLevel = toRiskEnum(mock.risk_level)
      let confidenceScore = mock.confidence_score
      let pAsd = confidenceScore
      let pTypical = 1 - confidenceScore

      // If we have real prediction from API, override the mock values
      if (apiPrediction) {
        if (typeof apiPrediction.p_asd === 'number') {
          pAsd = apiPrediction.p_asd
          pTypical = typeof apiPrediction.p_typical === 'number' ? apiPrediction.p_typical : 1 - pAsd
          confidenceScore = pAsd
        } else if (typeof apiPrediction.confidence === 'number') {
          confidenceScore = apiPrediction.confidence
          pAsd = confidenceScore
          pTypical = 1 - pAsd
        } else if (typeof apiPrediction.probability === 'number') {
          confidenceScore = apiPrediction.probability
          pAsd = confidenceScore
          pTypical = 1 - pAsd
        }

        const label = apiPrediction.label_name || apiPrediction.label

        if (typeof apiPrediction.is_asd === 'boolean') {
          riskLevel = apiPrediction.is_asd ? RiskLevel.HIGH : RiskLevel.LOW
        } else if (label === 'ASD' || label === 'Autism') {
          riskLevel = RiskLevel.HIGH
        } else if (label === 'Typical' || label === 'Normal') {
          riskLevel = RiskLevel.LOW
        } else if (confidenceScore >= 0.7) {
          riskLevel = RiskLevel.HIGH
        } else if (confidenceScore <= 0.3) {
          riskLevel = RiskLevel.LOW
        } else {
          riskLevel = RiskLevel.MEDIUM
        }
      }

      // Compute child age in years (rounded)
      let childAge: number | null = null
      if (video.child?.dateOfBirth) {
        const msAge = Date.now() - new Date(video.child.dateOfBirth).getTime()
        childAge = Math.floor(msAge / (1000 * 60 * 60 * 24 * 365.25))
      }

      // eslint-disable-next-line no-console
      console.log(`Calling LLM for recommendation for video ${videoId}...`)
      const recommendation = await callLlmForRecommendation({
        childName: video.child?.name ?? 'Bé',
        childAge,
        riskLevel,
        pAsd,
        pTypical,
      })

      await prisma.screeningResult.create({
        data: {
          videoId,
          riskLevel,
          confidenceScore,
          // Keep mock behavioral scores since Prisma schema still requires them
          eyeContactScore: mock.behavioral_scores.eye_contact,
          motorPatternScore: mock.behavioral_scores.motor_pattern,
          responseBehaviorScore: mock.behavioral_scores.response_behavior,
          repetitiveBehaviorScore: mock.behavioral_scores.repetitive_behavior,
          recommendation,
          rawAiResponse: {
            provider: env.BYPASS_EXTRACT_API ? 'mock' : 'openpose-api',
            generatedAt: new Date().toISOString(),
            extractedKeypoints: keypoints ? 'omitted_for_size' : null,
            apiPrediction,
            mockDiagnosis: mock,
          },
        },
      })

      await prisma.videoUpload.update({
        where: { id: videoId },
        data: { status: ScreeningStatus.COMPLETED },
      })
    } catch (e: any) {
      await prisma.videoUpload.update({
        where: { id: videoId },
        data: { status: ScreeningStatus.FAILED },
      })
      // eslint-disable-next-line no-console
      console.error(`Processing failed for video ${videoId}:`, e.message || e)
    } finally {
      const timeout = inFlight.get(videoId)
      if (timeout) clearTimeout(timeout)
      inFlight.delete(videoId)
    }
  }, delayMs)

  inFlight.set(videoId, handle)
}
