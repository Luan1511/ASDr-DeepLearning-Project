/** Pure helpers of the multi-view face enrolment (the camera loop lives in FamilyFaceEnrollment). */
import { FACE_VIEWS, type FaceTemplate, type FaceView } from './visionProfiles'
import { FACE_POSE, type HeadPose } from './visionPose'

export type CollectedViews = Partial<Record<FaceView, number[]>>

/** What one look at the camera found. */
export type EnrollProbe =
  | { status: 'no-face' | 'many-faces' | 'low-quality' | 'too-small' | 'out-of-frame' | 'embedding-failed' }
  | { status: 'ok'; view: FaceView | null; pitch: number; sample: number[] | null; hint?: string }

/** Frame coordinates are normalised to the actual camera picture. */
export type FaceBox = { x: number; y: number; width: number; height: number }

export function enrollmentQuality(box: FaceBox, eyeDistance: number, width: number, height: number): 'too-small' | 'out-of-frame' | null {
  if (box.x <= 0 || box.y <= 0 || box.x + box.width >= 1 || box.y + box.height >= 1) return 'out-of-frame'
  if (box.width * width < 52 || box.height * height < 55 || eyeDistance < 24) return 'too-small'
  return null
}

/** Explain a rejected pose without asking the user to guess the correct angle. */
export function poseHint(pose: HeadPose, neutralPitch: number | null): string {
  if (neutralPitch === null) {
    if (Math.abs(pose.yaw) > FACE_POSE.frontYaw) return 'Quay mặt về giữa màn hình và nhìn vào ống kính.'
    if (pose.pitch < FACE_POSE.neutralPitchMin) return 'Hạ cằm nhẹ hoặc nâng camera lên ngang tầm mắt.'
    if (pose.pitch > FACE_POSE.neutralPitchMax) return 'Ngẩng mặt nhẹ hoặc hạ camera xuống ngang tầm mắt.'
    return 'Giữ yên một chút để Bin lấy góc thẳng.'
  }
  if (Math.abs(pose.yaw) > FACE_POSE.sideYawMax) return 'Bạn xoay hơi nhiều rồi. Quay mặt trở lại một chút.'
  if (Math.abs(pose.pitch - neutralPitch) > FACE_POSE.tiltMax) return 'Chỉ ngẩng hoặc cúi nhẹ thôi, rồi giữ yên một chút.'
  return 'Xoay hoặc ngẩng, cúi thêm một chút, rồi giữ yên.'
}

export const FACE_VIEW_LABELS: Record<FaceView, string> = {
  front: 'Thẳng',
  left: 'Nghiêng trái',
  right: 'Nghiêng phải',
  up: 'Ngẩng',
  down: 'Cúi',
}

export const PROBE_NOTICES: Record<Exclude<EnrollProbe['status'], 'ok'>, string> = {
  'no-face': 'Chưa thấy khuôn mặt. Hãy nhìn vào camera.',
  'many-faces': 'Chỉ để một người trong khung hình.',
  'low-quality': 'Tiến gần camera hơn và giữ cả khuôn mặt trong khung hình.',
  'too-small': 'Tiến gần camera hơn để khuôn mặt lớn hơn trong khung.',
  'out-of-frame': 'Lùi nhẹ hoặc dịch vào giữa để thấy trọn khuôn mặt.',
  'embedding-failed': 'Bộ nhận diện chưa tạo được mẫu. Hãy chờ một chút và giữ yên; nếu còn lỗi, thử mở lại camera.',
}

/**
 * A view is captured only when the previous look saw the same view, so a head
 * that is still moving through a pose (motion blur) is not sampled.
 */
export function viewsToCapture(collected: CollectedViews, previousView: FaceView | null): FaceView[] {
  return previousView && !collected[previousView] ? [previousView] : []
}

export function isEnrollmentComplete(collected: CollectedViews) {
  return FACE_VIEWS.every((view) => collected[view])
}

/** The frontal sample is the only required one. */
export function toFaceTemplate(collected: CollectedViews): FaceTemplate | null {
  const { front, ...others } = collected
  return front ? { front, ...others } : null
}

/**
 * Next instruction. Sides are not named: which way is "left" depends on
 * whether the person reads the picture or their own body, and either order works.
 */
export function enrollmentHint(collected: CollectedViews): string {
  if (!collected.front) return 'Nhìn thẳng vào ống kính và giữ yên khoảng nửa giây. Bin tự lấy mẫu.'
  const sidesLeft = (['left', 'right'] as const).filter((view) => !collected[view]).length
  if (sidesLeft === 2) return 'Từ từ xoay nhẹ đầu sang một bên, rồi sang bên kia.'
  if (sidesLeft === 1) return 'Xoay nhẹ đầu sang bên còn lại.'
  if (!collected.up && !collected.down) return 'Hơi ngẩng mặt lên, rồi hơi cúi xuống.'
  if (!collected.up) return 'Hơi ngẩng mặt lên.'
  if (!collected.down) return 'Hơi cúi mặt xuống.'
  return 'Đã đủ các góc.'
}
