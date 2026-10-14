import { useState, type FormEvent } from 'react'
import { Loader2 } from 'lucide-react'
import { BODY_FOCUS_LABEL, DIFFICULTY_LABEL, type ExerciseMetadataInput } from '../../lib/exercises'
import type { BodyFocus, ExerciseStatus } from '../../lib/exerciseTypes'

const STATUS_STYLE: Record<ExerciseStatus, { label: string; className: string }> = {
  DRAFT: { label: 'Nháp', className: 'bg-duo-mist text-duo-mute' },
  PUBLISHED: { label: 'Đã xuất bản', className: 'bg-duo-green-soft text-duo-green-dark' },
  ARCHIVED: { label: 'Lưu trữ', className: 'bg-yellow-50 text-yellow-900' },
}

const BODY_FOCUS_OPTIONS: BodyFocus[] = ['ARMS', 'LEGS', 'TRUNK']
const SLUG_PATTERN = /^[a-z0-9-]{3,60}$/
const LIMITS = { title: 80, description: 500, childPrompt: 120 }

export function ExerciseStatusPill({ status }: { status: ExerciseStatus }) {
  const style = STATUS_STYLE[status]
  return <span className={['rounded-full px-2.5 py-0.5 text-[11px] font-extrabold', style.className].join(' ')}>{style.label}</span>
}

type FormValues = Required<ExerciseMetadataInput>

function validate(v: FormValues): string | null {
  if (!SLUG_PATTERN.test(v.slug)) return 'Slug gồm 3–60 ký tự: chữ thường không dấu, số và dấu gạch ngang.'
  if (!v.title.trim() || v.title.trim().length > LIMITS.title) return `Tên bài cần từ 1 đến ${LIMITS.title} ký tự.`
  if (!v.description.trim() || v.description.trim().length > LIMITS.description)
    return `Mô tả cho phụ huynh cần từ 1 đến ${LIMITS.description} ký tự.`
  if (!v.childPrompt.trim() || v.childPrompt.trim().length > LIMITS.childPrompt)
    return `Lời bạn Mầm cần từ 1 đến ${LIMITS.childPrompt} ký tự.`
  if (v.bodyFocus.length === 0) return 'Chọn ít nhất một nhóm cơ thể.'
  if (!Number.isInteger(v.sortOrder)) return 'Thứ tự hiển thị phải là số nguyên.'
  return null
}

/** Metadata form shared by the create card and the edit page. */
export function ExerciseMetadataForm({
  initial,
  submitLabel,
  submitting,
  error,
  onSubmit,
  onCancel,
}: {
  initial?: Partial<ExerciseMetadataInput>
  submitLabel: string
  submitting: boolean
  error: string | null
  onSubmit: (values: Required<ExerciseMetadataInput>) => void
  onCancel?: () => void
}) {
  const [values, setValues] = useState<FormValues>({
    slug: initial?.slug ?? '',
    title: initial?.title ?? '',
    description: initial?.description ?? '',
    childPrompt: initial?.childPrompt ?? '',
    difficulty: initial?.difficulty ?? 1,
    bodyFocus: initial?.bodyFocus ?? ['ARMS'],
    sortOrder: initial?.sortOrder ?? 0,
  })
  const [localError, setLocalError] = useState<string | null>(null)

  const set = <K extends keyof FormValues>(key: K, value: FormValues[K]) => setValues((prev) => ({ ...prev, [key]: value }))

  function submit(e: FormEvent) {
    e.preventDefault()
    const problem = validate(values)
    setLocalError(problem)
    if (problem) return
    onSubmit({
      ...values,
      title: values.title.trim(),
      description: values.description.trim(),
      childPrompt: values.childPrompt.trim(),
    })
  }

  const shownError = localError ?? error

  return (
    <form className="space-y-4" onSubmit={submit} noValidate>
      <div className="grid gap-4 md:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-xs font-extrabold uppercase tracking-wide text-duo-mute">Slug (mã bài)</span>
          <input
            className="input-duo"
            value={values.slug}
            onChange={(e) => set('slug', e.target.value.trim().toLowerCase())}
            placeholder="dang-tay"
            maxLength={60}
            autoComplete="off"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-extrabold uppercase tracking-wide text-duo-mute">Tên bài</span>
          <input
            className="input-duo"
            value={values.title}
            onChange={(e) => set('title', e.target.value)}
            maxLength={LIMITS.title}
            placeholder="Dang tay như cánh chim"
          />
        </label>
      </div>

      <label className="block">
        <span className="mb-1 flex justify-between text-xs font-extrabold uppercase tracking-wide text-duo-mute">
          <span>Mô tả cho phụ huynh</span>
          <span className="tabular-nums">
            {values.description.length}/{LIMITS.description}
          </span>
        </span>
        <textarea
          className="input-duo min-h-[88px]"
          value={values.description}
          onChange={(e) => set('description', e.target.value)}
          maxLength={LIMITS.description}
        />
      </label>

      <label className="block">
        <span className="mb-1 flex justify-between text-xs font-extrabold uppercase tracking-wide text-duo-mute">
          <span>Lời bạn Mầm nói với con</span>
          <span className="tabular-nums">
            {values.childPrompt.length}/{LIMITS.childPrompt}
          </span>
        </span>
        <input
          className="input-duo"
          value={values.childPrompt}
          onChange={(e) => set('childPrompt', e.target.value)}
          maxLength={LIMITS.childPrompt}
          placeholder="Mình cùng dang tay như cánh chim nhé!"
        />
      </label>

      <div className="grid gap-4 md:grid-cols-3">
        <label className="block">
          <span className="mb-1 block text-xs font-extrabold uppercase tracking-wide text-duo-mute">Độ khó</span>
          <select
            className="input-duo"
            value={values.difficulty}
            onChange={(e) => set('difficulty', Number(e.target.value) as 1 | 2 | 3)}
          >
            {([1, 2, 3] as const).map((d) => (
              <option key={d} value={d}>
                {d} — {DIFFICULTY_LABEL[d]}
              </option>
            ))}
          </select>
        </label>
        <fieldset>
          <legend className="mb-1 block text-xs font-extrabold uppercase tracking-wide text-duo-mute">Nhóm cơ thể</legend>
          <div className="flex flex-wrap gap-3 pt-2">
            {BODY_FOCUS_OPTIONS.map((f) => (
              <label key={f} className="flex cursor-pointer items-center gap-2 text-sm font-bold text-duo-ink">
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-duo-green"
                  checked={values.bodyFocus.includes(f)}
                  onChange={(e) =>
                    set(
                      'bodyFocus',
                      e.target.checked
                        ? BODY_FOCUS_OPTIONS.filter((o) => o === f || values.bodyFocus.includes(o))
                        : values.bodyFocus.filter((o) => o !== f),
                    )
                  }
                />
                {BODY_FOCUS_LABEL[f]}
              </label>
            ))}
          </div>
        </fieldset>
        <label className="block">
          <span className="mb-1 block text-xs font-extrabold uppercase tracking-wide text-duo-mute">Thứ tự hiển thị</span>
          <input
            type="number"
            className="input-duo"
            value={values.sortOrder}
            step={1}
            onChange={(e) => set('sortOrder', Number(e.target.value))}
          />
        </label>
      </div>

      {shownError && <div className="rounded-2xl bg-red-50 px-4 py-3 text-sm font-bold text-duo-red">{shownError}</div>}

      <div className="flex flex-wrap gap-2">
        <button type="submit" className="btn-duo" disabled={submitting}>
          {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
          {submitting ? 'Đang lưu...' : submitLabel}
        </button>
        {onCancel && (
          <button type="button" className="btn-duo-secondary" disabled={submitting} onClick={onCancel}>
            Huỷ
          </button>
        )}
      </div>
    </form>
  )
}
