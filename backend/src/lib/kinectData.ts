import { createHash, timingSafeEqual } from 'crypto'

export const KINECT_VERSION = 'kinect-1'
export const KINECT_SCOPES = ['CAPTURE_SKELETON', 'ANALYZE_SKELETON', 'STORE_RESULT', 'LOCAL_RECORDING'] as const
export const KINECT_STATEMENT = {
  version: KINECT_VERSION,
  text: 'Tôi đồng ý thu tọa độ khung xương 3D của trẻ bằng Kinect, gửi lên máy chủ để phân tích và lưu kết quả gắn với hồ sơ trẻ. Lượt thu này không gửi video màu. App trên trạm giữ bản ghi tại máy; xóa trên website không tự xóa bản lưu ở trạm. Kết quả mô hình hỗ trợ phân tích, không phải chẩn đoán.',
  scopes: KINECT_SCOPES,
}
export const KINECT_JOINTS = ['Head','Neck','SpineShoulder','ShoulderLeft','ShoulderRight','ElbowLeft','ElbowRight','WristLeft','WristRight','ThumbLeft','ThumbRight','HandLeft','HandRight','HandTipLeft','HandTipRight','SpineMid','SpineBase','HipLeft','HipRight','KneeLeft','KneeRight','AnkleLeft','AnkleRight','FootLeft','FootRight']
export type KinectCapture = {
  schemaVersion: string; captureId: string; sessionId: string; deviceId: string; unit: string; coordinateSystem: string; nominalFps: number
  jointNames: string[]; timestampsMs: number[]; xyz: number[][][]; trackingState?: number[][]; frameIndex?: number[]
  trackingId?: string; recordingStartedAt?: string; stopReason?: string; source?: string
}
export function validateKinectCapture(value: unknown): asserts value is KinectCapture {
  const p = value as KinectCapture
  const finite = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x)
  if (!p || p.schemaVersion !== 'kinect25_xyz_v1' || p.unit !== 'meters' || p.coordinateSystem !== 'kinect_camera' || p.nominalFps !== 30) throw new Error('INVALID_KINECT_CAPTURE')
  if (!Array.isArray(p.jointNames) || p.jointNames.length !== 25 || new Set(p.jointNames).size !== 25 || p.jointNames.some(n => !KINECT_JOINTS.includes(n))) throw new Error('INVALID_JOINTS')
  if (!Array.isArray(p.xyz) || p.xyz.length < 2 || p.xyz.length > 1200 || !p.xyz.every(f => Array.isArray(f) && f.length === 25 && f.every(j => Array.isArray(j) && j.length === 3 && j.every(x => finite(x) && Math.abs(x) <= 100)))) throw new Error('INVALID_XYZ')
  const n = p.xyz.length
  if (!Array.isArray(p.timestampsMs) || p.timestampsMs.length !== n || !p.timestampsMs.every((t,i) => finite(t) && (i === 0 || t > p.timestampsMs[i-1]))) throw new Error('INVALID_TIMESTAMPS')
  if (p.trackingState && (!Array.isArray(p.trackingState) || p.trackingState.length !== n || !p.trackingState.every(f => Array.isArray(f) && f.length === 25 && f.every(s => Number.isInteger(s) && s >= 0 && s <= 2)))) throw new Error('INVALID_TRACKING_STATE')
  if (p.frameIndex && (!Array.isArray(p.frameIndex) || p.frameIndex.length !== n || !p.frameIndex.every((v,i) => Number.isSafeInteger(v) && v >= 0 && (i === 0 || v > p.frameIndex![i-1])))) throw new Error('INVALID_FRAME_INDEX')
  const ids = (p as unknown as { trackingIds?: unknown }).trackingIds
  if (ids !== undefined && (!Array.isArray(ids) || ids.length !== n || !ids.every(v => typeof v === 'string' && v === ids[0]) || (p.trackingId && p.trackingId !== ids[0]))) throw new Error('MIXED_TRACKING_IDS')
}
export function trimKinectCapture(p: KinectCapture, start: number, end: number): KinectCapture {
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end > p.xyz.length || end-start < 2) throw new Error('INVALID_TRIM')
  return { ...p, xyz:p.xyz.slice(start,end), timestampsMs:p.timestampsMs.slice(start,end), trackingState:p.trackingState?.slice(start,end), frameIndex:p.frameIndex?.slice(start,end), ...((p as any).trackingIds ? {trackingIds:(p as any).trackingIds.slice(start,end)} : {}) }
}
export function hashKinect(data: Buffer | string) { return createHash('sha256').update(data).digest('hex') }
export function validBridgeKey(input: unknown) {
  const secret = process.env.KINECT_BRIDGE_KEY ?? ''
  if (secret.length < 32 || typeof input !== 'string') return false
  const a = Buffer.from(input), b = Buffer.from(secret)
  return a.length === b.length && timingSafeEqual(a,b)
}
