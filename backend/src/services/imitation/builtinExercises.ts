/**
 * Six synthetic demonstrations (imitation-v1 §H) so the feature works and can
 * be tested before any adult team member has recorded a template. Adult
 * proportions, 25 fps, 1 s neutral at the start and the end, mirror policy
 * EITHER. They are synced as DRAFT exercises and never published automatically.
 */
import { ADULT_BODY, NEUTRAL_POSE, bump, makeSyntheticFrames, ramp, type SyntheticExerciseSpec } from './syntheticPose'
import type { BuiltinExercise } from './types'

export const BUILTIN_FPS = 25
export const BUILTIN_NEUTRAL_SEC = 1

const N = NEUTRAL_POSE

/** 0 → 1 → 0 envelope that fades the movement in and out over `fade` seconds. */
function envelope(t: number, start: number, end: number, fade: number): number {
  return ramp(t, start, fade) * (1 - ramp(t, end - fade, fade))
}

export const BUILTIN_SPECS: Record<string, SyntheticExerciseSpec> = {
  // Both arms out to the side and down again, three times.
  'dang-tay': {
    durationSec: 8,
    pose(t) {
      let b = 0
      for (let k = 0; k < 3; k += 1) b += bump(t, 1 + 2 * k, 2)
      return { lUpper: N.lUpper + 82 * b, lFore: N.lFore + 84 * b, rUpper: N.rUpper + 82 * b, rFore: N.rFore + 84 * b }
    },
  },
  // Right arm up, wave the hand three times, arm down (left arm stays still).
  'gio-tay-chao': {
    durationSec: 7.5,
    pose(t) {
      const up = ramp(t, 1, 1.5) * (1 - ramp(t, 5, 1.5))
      const wave = t > 2.5 && t < 5 ? 25 * Math.sin(2 * Math.PI * 1.2 * (t - 2.5)) * envelope(t, 2.5, 5, 0.3) : 0
      return { rUpper: N.rUpper + 132 * up, rFore: N.rFore + 150 * up + wave }
    },
  },
  // Both arms over the head (past ±180°) and down, twice.
  'vuon-cao': {
    durationSec: 8,
    pose(t) {
      const b = bump(t, 1, 3) + bump(t, 4, 3)
      return { lUpper: N.lUpper + 177 * b, lFore: N.lFore + 179 * b, rUpper: N.rUpper + 177 * b, rFore: N.rFore + 179 * b }
    },
  },
  // Side bend left and right, three slow cycles.
  'nghieng-nguoi': {
    durationSec: 9.5,
    pose(t) {
      const lean = t > 1 && t < 8.5 ? 18 * Math.sin((2 * Math.PI * (t - 1)) / 2.5) * envelope(t, 1, 8.5, 0.6) : 0
      return { lean }
    },
  },
  // Squat with the arms reaching forward, twice.
  'ngoi-xuong': {
    durationSec: 8,
    pose(t) {
      const d = bump(t, 1, 3) + bump(t, 4, 3)
      return {
        lThigh: N.lThigh + 12 * d,
        rThigh: N.rThigh + 12 * d,
        lThighFwd: 0.6 * d,
        rThighFwd: 0.6 * d,
        lShank: N.lShank + 3 * d,
        rShank: N.rShank + 3 * d,
        lShankFwd: 0.1 * d,
        rShankFwd: 0.1 * d,
        lUpperFwd: 0.9 * d,
        rUpperFwd: 0.9 * d,
        lForeFwd: 0.9 * d,
        rForeFwd: 0.9 * d,
      }
    },
  },
  // Marching in place: left knee, right knee, four times each.
  'buoc-deu': {
    durationSec: 8.4,
    pose(t) {
      const env = envelope(t, 1, 7.4, 1)
      let left = 0
      let right = 0
      for (let k = 0; k < 4; k += 1) {
        left += bump(t, 1 + 1.6 * k, 0.8)
        right += bump(t, 1.8 + 1.6 * k, 0.8)
      }
      return {
        lThighFwd: 0.5 * left * env,
        rThighFwd: 0.5 * right * env,
        lShankFwd: 0.05 * left * env,
        rShankFwd: 0.05 * right * env,
      }
    },
  },
}

type BuiltinMeta = Omit<BuiltinExercise, 'fps' | 'makeFrames' | 'mirrorPolicy'>

const META: BuiltinMeta[] = [
  {
    slug: 'dang-tay',
    title: 'Dang tay như cánh chim',
    description:
      'Con dang hai tay sang ngang rồi hạ xuống, ba lần, như chim vỗ cánh. Bài tập giúp con luyện quan sát và làm theo động tác của cả hai tay cùng lúc.',
    childPrompt: 'Mình cùng dang tay như chú chim nhé! Vỗ cánh ba lần nào!',
    difficulty: 1,
    bodyFocus: ['ARMS'],
    experimental: false,
    sortOrder: 10,
  },
  {
    slug: 'gio-tay-chao',
    title: 'Giơ tay phải chào',
    description:
      'Con giơ tay phải lên cao, vẫy chào rồi hạ tay xuống. Nếu con làm theo kiểu soi gương (dùng tay trái) thì vẫn được tính điểm.',
    childPrompt: 'Giơ tay lên thật cao và vẫy chào bạn Mầm nào!',
    difficulty: 1,
    bodyFocus: ['ARMS'],
    experimental: false,
    sortOrder: 20,
  },
  {
    slug: 'vuon-cao',
    title: 'Vươn tay lên cao',
    description: 'Con đưa hai tay qua hai bên lên thẳng trên đầu rồi hạ xuống, hai lần.',
    childPrompt: 'Vươn tay thật cao như muốn chạm vào ông mặt trời nhé!',
    difficulty: 1,
    bodyFocus: ['ARMS'],
    experimental: false,
    sortOrder: 30,
  },
  {
    slug: 'nghieng-nguoi',
    title: 'Nghiêng người như cây trong gió',
    description:
      'Con đứng yên hai chân, nghiêng người sang trái rồi sang phải, ba lần, như cái cây lắc lư trong gió.',
    childPrompt: 'Gió thổi rồi! Mình nghiêng người qua lại như cái cây nhé!',
    difficulty: 2,
    bodyFocus: ['TRUNK'],
    experimental: false,
    sortOrder: 40,
  },
  {
    slug: 'ngoi-xuong',
    title: 'Ngồi xuống đứng lên',
    description:
      'Con đưa hai tay ra phía trước, ngồi xuống thật thấp rồi đứng lên, hai lần. Nên tập ở chỗ rộng và có người lớn đứng gần.',
    childPrompt: 'Mình cùng ngồi xuống thật thấp rồi đứng lên nào!',
    difficulty: 2,
    bodyFocus: ['LEGS', 'TRUNK'],
    experimental: false,
    sortOrder: 50,
  },
  {
    slug: 'buoc-deu',
    title: 'Bước đều tại chỗ',
    description:
      'Con nâng gối trái rồi gối phải, bước đều tại chỗ. Camera đặt phía trước khó thấy rõ động tác nâng gối nên cách chấm bài này đang được thử nghiệm thêm.',
    childPrompt: 'Một, hai, một, hai! Mình bước đều tại chỗ cùng bạn Mầm nhé!',
    difficulty: 3,
    bodyFocus: ['LEGS'],
    experimental: true,
    sortOrder: 60,
  },
]

/** Adult demonstrator in a 1920×1080 picture, clean keypoints. */
export function renderBuiltin(slug: string): ReturnType<typeof makeSyntheticFrames> {
  const spec = BUILTIN_SPECS[slug]
  if (!spec) throw new Error(`unknown built-in exercise ${slug}`)
  return makeSyntheticFrames(spec, { fps: BUILTIN_FPS, body: ADULT_BODY, width: 1920, height: 1080, pxPerTorso: 200 })
}

export const BUILTIN_EXERCISES: BuiltinExercise[] = META.map((meta) => ({
  ...meta,
  mirrorPolicy: 'EITHER',
  fps: BUILTIN_FPS,
  makeFrames: () => renderBuiltin(meta.slug),
}))

/** Picture size of the built-in demonstrations (for buildTemplate's videoSize). */
export const BUILTIN_VIDEO_SIZE = Object.freeze({ width: 1920, height: 1080 })
