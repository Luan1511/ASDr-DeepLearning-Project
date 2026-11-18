/** Pure helpers of the multi-view face enrolment (the camera loop lives in FamilyFaceEnrollment). */
import { FACE_VIEWS, type FaceTemplate, type FaceView } from './visionProfiles'

export type CollectedViews = Partial<Record<FaceView, number[]>>

/** What one look at the camera found. */
export type EnrollProbe =
  | { status: 'no-face' | 'many-faces' | 'low-quality' }
  | { status: 'ok'; view: FaceView | null; pitch: number; sample: number[] | null }

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
  if (!collected.front) return 'Nhìn thẳng vào camera và giữ yên một chút.'
  const sidesLeft = (['left', 'right'] as const).filter((view) => !collected[view]).length
  if (sidesLeft === 2) return 'Từ từ xoay nhẹ đầu sang một bên, rồi sang bên kia.'
  if (sidesLeft === 1) return 'Xoay nhẹ đầu sang bên còn lại.'
  if (!collected.up && !collected.down) return 'Hơi ngẩng mặt lên, rồi hơi cúi xuống.'
  if (!collected.up) return 'Hơi ngẩng mặt lên.'
  if (!collected.down) return 'Hơi cúi mặt xuống.'
  return 'Đã đủ các góc.'
}
