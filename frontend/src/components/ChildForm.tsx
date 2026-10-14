import { useState, type FormEvent } from 'react'
import type { ChildProfile, Gender } from '../lib/types'
import { GENDER_LABEL, toDateInputValue, todayInputValue } from '../lib/format'

export type ChildFormValues = { fullName: string; dateOfBirth: string; gender: Gender; note: string }

const LABEL = 'mb-1 block text-xs font-extrabold uppercase tracking-wide text-duo-mute'
const GENDERS: Gender[] = ['UNSPECIFIED', 'MALE', 'FEMALE', 'OTHER']

/** Create / edit form for a child profile. */
export function ChildForm({
  initial,
  submitLabel,
  submitting,
  error,
  onSubmit,
  onCancel,
}: {
  initial?: ChildProfile
  submitLabel: string
  submitting: boolean
  error?: string | null
  onSubmit: (values: ChildFormValues) => void
  onCancel?: () => void
}) {
  const [fullName, setFullName] = useState(initial?.fullName ?? '')
  const [dateOfBirth, setDateOfBirth] = useState(initial ? toDateInputValue(initial.dateOfBirth) : '')
  const [gender, setGender] = useState<Gender>(initial?.gender ?? 'UNSPECIFIED')
  const [note, setNote] = useState(initial?.note ?? '')
  const [localError, setLocalError] = useState<string | null>(null)
  const today = todayInputValue()

  function submit(e: FormEvent) {
    e.preventDefault()
    if (!fullName.trim() || !dateOfBirth) {
      setLocalError('Vui lòng nhập họ tên và ngày sinh của trẻ.')
      return
    }
    if (dateOfBirth > today) {
      setLocalError('Ngày sinh không được sau hôm nay.')
      return
    }
    setLocalError(null)
    onSubmit({ fullName: fullName.trim(), dateOfBirth, gender, note: note.trim() })
  }

  const shownError = localError ?? error

  return (
    <form onSubmit={submit} className="space-y-3" noValidate>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <label className="block">
          <span className={LABEL}>Họ tên</span>
          <input
            className="input-duo"
            value={fullName}
            maxLength={100}
            onChange={(e) => setFullName(e.target.value)}
            autoComplete="off"
          />
        </label>
        <label className="block">
          <span className={LABEL}>Ngày sinh</span>
          <input className="input-duo" type="date" max={today} value={dateOfBirth} onChange={(e) => setDateOfBirth(e.target.value)} />
        </label>
        <label className="block">
          <span className={LABEL}>Giới tính</span>
          <select className="input-duo" value={gender} onChange={(e) => setGender(e.target.value as Gender)}>
            {GENDERS.map((g) => (
              <option key={g} value={g}>
                {g === 'UNSPECIFIED' ? 'Không nêu' : GENDER_LABEL[g]}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="block">
        <span className={LABEL}>Ghi chú (tuỳ chọn)</span>
        <textarea
          className="input-duo min-h-[80px] resize-y"
          value={note}
          maxLength={1000}
          rows={3}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Ví dụ: thói quen của trẻ, điều cần lưu ý khi quay video."
        />
      </label>

      {shownError && <div className="rounded-2xl bg-red-50 px-4 py-3 text-sm font-bold text-duo-red">{shownError}</div>}

      <div className="flex flex-wrap gap-2">
        <button type="submit" className="btn-duo" disabled={submitting}>
          {submitting ? 'Đang lưu...' : submitLabel}
        </button>
        {onCancel && (
          <button type="button" className="btn-duo-secondary" onClick={onCancel} disabled={submitting}>
            Huỷ
          </button>
        )}
      </div>
    </form>
  )
}
