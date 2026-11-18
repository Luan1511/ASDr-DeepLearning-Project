/**
 * Personalisation of a child's profile (Giai đoạn 6): what the parent tells
 * the app about the child, and the simple, explainable rules that turn it and
 * the child's practice history into suggestions. Nothing here is a screening
 * or a medical judgement; every suggestion carries its reason in plain words
 * and the parent can always choose differently.
 */
import type { ChildPersonalization } from '@prisma/client'
import { z } from 'zod'
import type { ExerciseProgress } from './exerciseData'

export const COMMUNICATION_LEVELS = ['NOT_YET_SPEAKING', 'SINGLE_WORDS', 'SHORT_PHRASES', 'SENTENCES'] as const
export const SENSORY_TAGS = ['SOUND', 'LIGHT', 'TOUCH', 'CROWD', 'CHANGE'] as const
export const FOCUS_AREAS = ['ARMS', 'LEGS', 'TRUNK'] as const
export const GUIDE_SPEEDS = ['AUTO', 'NORMAL', 'SLOW'] as const
export const PRACTICE_MODE_PREFS = ['AUTO', 'FOLLOW_ALONG', 'AFTER_DEMO'] as const

export type CommunicationLevel = (typeof COMMUNICATION_LEVELS)[number]
export type SensoryTag = (typeof SENSORY_TAGS)[number]
export type FocusArea = (typeof FOCUS_AREAS)[number]
export type GuideSpeed = (typeof GUIDE_SPEEDS)[number]
export type PracticeModePref = (typeof PRACTICE_MODE_PREFS)[number]

export const NICKNAME_MAX = 40
export const INTEREST_MAX_COUNT = 12
export const INTEREST_MAX_LENGTH = 40
export const FREE_TEXT_MAX = 500

const freeText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .optional()
    .transform((v) => (v ? v : null))

/** Body of PUT /children/:id/personalization: the whole form; a missing field goes back to its default. */
export const personalizationSchema = z
  .object({
    nickname: freeText(NICKNAME_MAX),
    interests: z
      .array(z.string().trim().min(1).max(INTEREST_MAX_LENGTH))
      .max(INTEREST_MAX_COUNT)
      .optional()
      .transform((list) => Array.from(new Set(list ?? []))),
    communication: z.enum(COMMUNICATION_LEVELS).nullable().optional().transform((v) => v ?? null),
    sensory: z
      .array(z.enum(SENSORY_TAGS))
      .optional()
      .transform((list) => SENSORY_TAGS.filter((tag) => (list ?? []).includes(tag))),
    calming: freeText(FREE_TEXT_MAX),
    goals: freeText(FREE_TEXT_MAX),
    focusAreas: z
      .array(z.enum(FOCUS_AREAS))
      .optional()
      .transform((list) => FOCUS_AREAS.filter((area) => (list ?? []).includes(area))),
    guideSpeed: z.enum(GUIDE_SPEEDS).optional().default('AUTO'),
    practiceMode: z.enum(PRACTICE_MODE_PREFS).optional().default('AUTO'),
    liveCoach: z.boolean().nullable().optional().transform((v) => v ?? null),
    weeklyGoal: z.number().int().min(1).max(7).nullable().optional().transform((v) => v ?? null),
  })
  .strict()

export type PersonalizationInput = z.infer<typeof personalizationSchema>

export type Personalization = PersonalizationInput & { updatedAt: Date | null }

export const DEFAULT_PERSONALIZATION: Personalization = {
  nickname: null,
  interests: [],
  communication: null,
  sensory: [],
  calming: null,
  goals: null,
  focusAreas: [],
  guideSpeed: 'AUTO',
  practiceMode: 'AUTO',
  liveCoach: null,
  weeklyGoal: null,
  updatedAt: null,
}

const within = <T extends string>(allowed: readonly T[], value: string | null | undefined, fallback: T): T =>
  (allowed as readonly string[]).includes(value ?? '') ? (value as T) : fallback

/** Stored row (or none yet) → the DTO; unknown stored values fall back to the defaults. */
export function serializePersonalization(row: ChildPersonalization | null): Personalization {
  if (!row) return { ...DEFAULT_PERSONALIZATION }
  return {
    nickname: row.nickname,
    interests: row.interests,
    communication: (COMMUNICATION_LEVELS as readonly string[]).includes(row.communication ?? '')
      ? (row.communication as CommunicationLevel)
      : null,
    sensory: SENSORY_TAGS.filter((tag) => row.sensory.includes(tag)),
    calming: row.calming,
    goals: row.goals,
    focusAreas: FOCUS_AREAS.filter((area) => row.focusAreas.includes(area)),
    guideSpeed: within(GUIDE_SPEEDS, row.guideSpeed, 'AUTO'),
    practiceMode: within(PRACTICE_MODE_PREFS, row.practiceMode, 'AUTO'),
    liveCoach: row.liveCoach,
    weeklyGoal: row.weeklyGoal,
    updatedAt: row.updatedAt,
  }
}

/** True when the parent has not filled in anything yet. */
export function isEmptyPersonalization(p: Personalization): boolean {
  return (
    !p.nickname &&
    p.interests.length === 0 &&
    !p.communication &&
    p.sensory.length === 0 &&
    !p.calming &&
    !p.goals &&
    p.focusAreas.length === 0 &&
    p.guideSpeed === 'AUTO' &&
    p.practiceMode === 'AUTO' &&
    p.liveCoach === null &&
    p.weeklyGoal === null
  )
}

// ---------------------------------------------------------------------------
// Exercise plan (rules)
// ---------------------------------------------------------------------------

export const PLAN_RULES = Object.freeze({
  /** Scores that count as "comfortable" / "ready for more" / "still hard". */
  comfortable: 60,
  ready: 80,
  hard: 50,
  /** Scored attempts looked at for a level. */
  window: 3,
  maxRecommendations: 3,
})

export type PlanExercise = { id: string; slug: string; title: string; difficulty: number; bodyFocus: string[] }

export type ExerciseSettings = {
  playbackRate: 0.75 | 1
  /** Null: no preference, the page picks by screen size as before. */
  practiceMode: 'FOLLOW_ALONG' | 'AFTER_DEMO' | null
  /** Analyse the camera during practice and let Bin remind / praise. */
  liveCoach: boolean
  /** Speak the reminders (off for a child who is sensitive to sound). */
  coachVoice: boolean
  /** Why these differ from the plain defaults, in the parent's words. */
  reasons: SettingReason[]
}

/** `topic` lets a page leave out what does not apply (the coach only exists for some exercises). */
export type SettingReason = { topic: 'speed' | 'mode' | 'coach'; text: string }

export type RecommendationKind = 'START' | 'CONTINUE' | 'STEP_UP' | 'NEW' | 'REVIEW'

export type ExerciseRecommendation = {
  exerciseId: string
  kind: RecommendationKind
  reason: string
  settings: ExerciseSettings
}

export type ExercisePlan = {
  /** Difficulty (1–3) the child currently practises comfortably. */
  level: 1 | 2 | 3
  weekly: { goal: number | null; daysPractised: number; weekStart: Date }
  recommendations: ExerciseRecommendation[]
}

const LEVEL_LABEL: Record<number, string> = { 1: 'Dễ', 2: 'Vừa', 3: 'Khó hơn' }
const FOCUS_LABEL: Record<string, string> = { ARMS: 'tay', LEGS: 'chân', TRUNK: 'thân người' }

const clampLevel = (difficulty: number): 1 | 2 | 3 => (difficulty >= 3 ? 3 : difficulty <= 1 ? 1 : 2)

type Scored = { at: Date; overall: number }

/** Scored attempts of one exercise, oldest first. */
function scoredAttempts(progress: ExerciseProgress | undefined): Scored[] {
  if (!progress) return []
  return progress.series
    .flatMap((s) => s.points)
    .filter((p): p is typeof p & { overall: number } => p.status === 'SCORED' && typeof p.overall === 'number')
    .map((p) => ({ at: p.at, overall: p.overall }))
    .sort((a, b) => a.at.getTime() - b.at.getTime())
}

const mean = (values: number[]) => values.reduce((sum, v) => sum + v, 0) / values.length

/**
 * Suggested settings for one exercise. A parent's explicit choice always
 * wins; "AUTO" lets the history decide, and says why.
 */
export function suggestExerciseSettings(
  prefs: Personalization,
  exercise: Pick<PlanExercise, 'difficulty'>,
  progress: ExerciseProgress | undefined,
): ExerciseSettings {
  const reasons: SettingReason[] = []
  const scored = scoredAttempts(progress)
  const level = clampLevel(exercise.difficulty)

  let playbackRate: 0.75 | 1 = 1
  if (prefs.guideSpeed === 'SLOW') {
    playbackRate = 0.75
    reasons.push({ topic: 'speed', text: 'Bố mẹ đã chọn để Bin làm mẫu chậm hơn.' })
  } else if (prefs.guideSpeed === 'AUTO') {
    const lastTwo = scored.slice(-2)
    if (lastTwo.length === 2 && lastTwo.every((s) => s.overall < PLAN_RULES.comfortable)) {
      playbackRate = 0.75
      reasons.push({ topic: 'speed', text: 'Hai lần gần nhất con chưa theo kịp bài này nên Bin làm mẫu chậm hơn.' })
    } else if (scored.length === 0 && level >= 2) {
      playbackRate = 0.75
      reasons.push({ topic: 'speed', text: `Lần đầu con tập một bài ở mức ${LEVEL_LABEL[level]} nên Bin làm mẫu chậm hơn.` })
    }
  }

  const practiceMode = prefs.practiceMode === 'AUTO' ? null : prefs.practiceMode
  if (practiceMode) {
    reasons.push({
      topic: 'mode',
      text:
        practiceMode === 'FOLLOW_ALONG'
          ? 'Bố mẹ đã chọn cách tập “Làm cùng bạn Bin”.'
          : 'Bố mẹ đã chọn cách tập “Xem trước rồi làm theo”.',
    })
  }

  const liveCoach = prefs.liveCoach ?? true
  if (prefs.liveCoach === false) reasons.push({ topic: 'coach', text: 'Bố mẹ đã tắt lời nhắc của Bin trong lúc tập.' })
  const coachVoice = !prefs.sensory.includes('SOUND')
  if (liveCoach && !coachVoice) {
    reasons.push({ topic: 'coach', text: 'Con nhạy cảm với âm thanh nên Bin chỉ nhắc bằng chữ, không nói thành tiếng.' })
  }

  return { playbackRate, practiceMode, liveCoach, coachVoice, reasons }
}

/** Monday 00:00 (Việt Nam, UTC+7 all year) of the week that contains `now`. */
export function vietnamWeekStart(now: Date): Date {
  const OFFSET_MS = 7 * 60 * 60 * 1000
  const local = new Date(now.getTime() + OFFSET_MS)
  const daysSinceMonday = (local.getUTCDay() + 6) % 7
  const midnight = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() - daysSinceMonday)
  return new Date(midnight - OFFSET_MS)
}

function daysPractisedThisWeek(sessionDates: Date[], weekStart: Date): number {
  const OFFSET_MS = 7 * 60 * 60 * 1000
  const end = weekStart.getTime() + 7 * 24 * 60 * 60 * 1000
  const days = new Set<string>()
  for (const at of sessionDates) {
    if (at.getTime() < weekStart.getTime() || at.getTime() >= end) continue
    days.add(new Date(at.getTime() + OFFSET_MS).toISOString().slice(0, 10))
  }
  return days.size
}

/**
 * What to practise next, at most three exercises, each with its reason:
 *  1. the exercise the child is in the middle of (CONTINUE), or one that got
 *     hard lately, more slowly (REVIEW);
 *  2. a first exercise one level up when the last three scores at the current
 *     level were all high (STEP_UP);
 *  3. something new at the current level, preferring the parent's focus areas (NEW).
 * A child without any attempt starts with the easiest exercises (START).
 */
export function buildExercisePlan(input: {
  prefs: Personalization
  /** Published exercises in library order. */
  exercises: PlanExercise[]
  progress: ExerciseProgress[]
  /** Start time of every attempt of the child (any status). */
  sessionDates: Date[]
  now: Date
}): ExercisePlan {
  const { prefs, exercises, now } = input
  const byExercise = new Map(input.progress.map((p) => [p.exercise.id, p]))
  const weekStart = vietnamWeekStart(now)
  const weekly = { goal: prefs.weeklyGoal, daysPractised: daysPractisedThisWeek(input.sessionDates, weekStart), weekStart }

  // ---- level: the highest difficulty with at least two scored attempts that went comfortably
  const scoredAtLevel = (level: number) =>
    exercises
      .filter((e) => clampLevel(e.difficulty) === level)
      .flatMap((e) => scoredAttempts(byExercise.get(e.id)))
      .sort((a, b) => a.at.getTime() - b.at.getTime())
  let level: 1 | 2 | 3 = 1
  for (const candidate of [2, 3] as const) {
    const recent = scoredAtLevel(candidate).slice(-PLAN_RULES.window)
    if (recent.length >= 2 && mean(recent.map((s) => s.overall)) >= PLAN_RULES.comfortable) level = candidate
  }
  const atLevel = scoredAtLevel(level).slice(-PLAN_RULES.window)
  const ready = atLevel.length >= PLAN_RULES.window && atLevel.every((s) => s.overall >= PLAN_RULES.ready)

  const focusFirst = (list: PlanExercise[]) => {
    if (!prefs.focusAreas.length) return list
    const inFocus = (e: PlanExercise) => e.bodyFocus.some((f) => (prefs.focusAreas as string[]).includes(f))
    return [...list.filter(inFocus), ...list.filter((e) => !inFocus(e))]
  }
  const focusNote = (e: PlanExercise) => {
    const shared = e.bodyFocus.filter((f) => (prefs.focusAreas as string[]).includes(f))
    return shared.length ? `, luyện ${shared.map((f) => FOCUS_LABEL[f] ?? f).join(' và ')} như bố mẹ mong muốn` : ''
  }

  const recommendations: ExerciseRecommendation[] = []
  const add = (exercise: PlanExercise | undefined, kind: RecommendationKind, reason: string) => {
    if (!exercise || recommendations.length >= PLAN_RULES.maxRecommendations) return
    if (recommendations.some((r) => r.exerciseId === exercise.id)) return
    recommendations.push({
      exerciseId: exercise.id,
      kind,
      reason,
      settings: suggestExerciseSettings(prefs, exercise, byExercise.get(exercise.id)),
    })
  }

  const practised = exercises.filter((e) => (byExercise.get(e.id)?.attempts ?? 0) > 0)
  const untouched = exercises.filter((e) => !practised.includes(e))

  if (practised.length === 0) {
    for (const exercise of focusFirst(exercises.filter((e) => clampLevel(e.difficulty) === 1))) {
      add(exercise, 'START', `Một bài ở mức Dễ để con làm quen với bạn Bin${focusNote(exercise)}.`)
    }
    // A library without easy exercises: start with whatever comes first.
    if (recommendations.length === 0) {
      add(exercises[0], 'START', 'Bài đầu tiên trong thư viện để con làm quen với bạn Bin.')
    }
    return { level, weekly, recommendations }
  }

  // 1. the exercise most recently practised, when it is not yet settled
  const latest = [...practised].sort(
    (a, b) => (byExercise.get(b.id)?.lastAt?.getTime() ?? 0) - (byExercise.get(a.id)?.lastAt?.getTime() ?? 0),
  )[0]
  const latestScored = scoredAttempts(byExercise.get(latest.id))
  const lastTwo = latestScored.slice(-2)
  if (lastTwo.length === 2 && lastTwo.every((s) => s.overall < PLAN_RULES.hard)) {
    add(latest, 'REVIEW', 'Hai lần gần nhất bài này còn khó với con. Con tập lại chậm hơn, không cần vội.')
  } else if (latestScored.length < PLAN_RULES.window) {
    add(latest, 'CONTINUE', `Con mới tập bài này ${byExercise.get(latest.id)?.attempts ?? 0} lần. Tập thêm vài lần để quen động tác.`)
  } else if (latestScored[latestScored.length - 1].overall < PLAN_RULES.ready) {
    add(
      latest,
      'CONTINUE',
      `Lần gần nhất con đạt ${latestScored[latestScored.length - 1].overall} điểm ở bài này. Tập thêm để làm giống bạn Bin hơn.`,
    )
  }

  // 2. one level up
  if (ready && level < 3) {
    const next = (level + 1) as 2 | 3
    const candidates = focusFirst(exercises.filter((e) => clampLevel(e.difficulty) === next))
    add(
      candidates.find((e) => untouched.includes(e)) ?? candidates[0],
      'STEP_UP',
      `Ba lần gần nhất ở mức ${LEVEL_LABEL[level]} con đều đạt từ ${PLAN_RULES.ready} điểm. Con thử một bài ở mức ${LEVEL_LABEL[next]} nhé.`,
    )
  }

  // 3. something new at (or below) the current level
  for (const exercise of focusFirst(untouched.filter((e) => clampLevel(e.difficulty) <= level))) {
    add(exercise, 'NEW', `Bài mới ở mức ${LEVEL_LABEL[clampLevel(exercise.difficulty)]}${focusNote(exercise)}.`)
  }

  // Nothing new left: keep practising what the child knows, least recent first.
  if (recommendations.length === 0) {
    const leastRecent = [...practised].sort(
      (a, b) => (byExercise.get(a.id)?.lastAt?.getTime() ?? 0) - (byExercise.get(b.id)?.lastAt?.getTime() ?? 0),
    )
    for (const exercise of leastRecent) add(exercise, 'CONTINUE', 'Con đã tập hết các bài ở mức này. Ôn lại bài lâu chưa tập nhé.')
  }

  return { level, weekly, recommendations }
}
