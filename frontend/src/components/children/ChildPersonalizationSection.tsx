import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { Info, Loader2, Pencil, Plus, Sparkles, X } from 'lucide-react'
import { Card } from '../Card'
import { apiErrorCode } from '../../lib/api'
import { BODY_FOCUS_LABEL } from '../../lib/exercises'
import type { BodyFocus } from '../../lib/exerciseTypes'
import { formatDate } from '../../lib/format'
import {
  COMMUNICATION_LABEL,
  EMPTY_PERSONALIZATION,
  FOCUS_ORDER,
  FREE_TEXT_MAX,
  GUIDE_SPEED_LABEL,
  INTEREST_MAX_COUNT,
  INTEREST_MAX_LENGTH,
  INTEREST_SUGGESTIONS,
  NICKNAME_MAX,
  PERSONALIZATION_NOTE,
  PRACTICE_PREF_LABEL,
  SENSORY_LABEL,
  SENSORY_ORDER,
  fetchPersonalization,
  personalizationErrorMessage,
  savePersonalization,
  type CommunicationLevel,
  type GuideSpeed,
  type Personalization,
  type PersonalizationInput,
  type PracticeModePref,
  type SensoryTag,
} from '../../lib/personalization'

type SectionState =
  | { kind: 'loading' }
  | { kind: 'hidden' }
  | { kind: 'migration' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; personalization: Personalization; empty: boolean }

const toInput = (p: Personalization): PersonalizationInput => ({
  nickname: p.nickname,
  interests: p.interests,
  communication: p.communication,
  sensory: p.sensory,
  calming: p.calming,
  goals: p.goals,
  focusAreas: p.focusAreas,
  guideSpeed: p.guideSpeed,
  practiceMode: p.practiceMode,
  liveCoach: p.liveCoach,
  weeklyGoal: p.weeklyGoal,
})

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={[
        'rounded-full px-3 py-1.5 text-xs font-extrabold transition-all',
        active ? 'bg-duo-green-soft text-duo-green-dark shadow-ring-green' : 'bg-duo-mist text-duo-mute hover:text-duo-ink',
      ].join(' ')}
    >
      {children}
    </button>
  )
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div>
      <div className="mb-1 text-xs font-extrabold uppercase tracking-wide text-duo-mute">{label}</div>
      {children}
      {hint && <div className="mt-1 text-xs font-semibold leading-relaxed text-duo-mute">{hint}</div>}
    </div>
  )
}

function SummaryItem({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="rounded-2xl bg-duo-mist px-4 py-3">
      <div className="text-xs font-extrabold uppercase tracking-wide text-duo-mute">{label}</div>
      <div className="mt-1 text-sm font-bold leading-relaxed text-duo-ink">{children}</div>
    </div>
  )
}

const toggle = <T,>(list: T[], value: T): T[] => (list.includes(value) ? list.filter((v) => v !== value) : [...list, value])

function PersonalizationForm({
  childName,
  initial,
  saving,
  error,
  onCancel,
  onSubmit,
}: {
  childName: string
  initial: PersonalizationInput
  saving: boolean
  error: string | null
  onCancel: () => void
  onSubmit: (value: PersonalizationInput) => void
}) {
  const [value, setValue] = useState<PersonalizationInput>(initial)
  const [interestDraft, setInterestDraft] = useState('')
  const set = <K extends keyof PersonalizationInput>(key: K, next: PersonalizationInput[K]) => setValue((v) => ({ ...v, [key]: next }))

  const addInterest = (raw: string) => {
    const interest = raw.trim().slice(0, INTEREST_MAX_LENGTH)
    if (!interest || value.interests.length >= INTEREST_MAX_COUNT) return
    if (!value.interests.some((i) => i.toLowerCase() === interest.toLowerCase())) set('interests', [...value.interests, interest])
    setInterestDraft('')
  }

  const submit = (e: FormEvent) => {
    e.preventDefault()
    const pending = interestDraft.trim().slice(0, INTEREST_MAX_LENGTH)
    const interests =
      pending && value.interests.length < INTEREST_MAX_COUNT && !value.interests.includes(pending)
        ? [...value.interests, pending]
        : value.interests
    onSubmit({ ...value, interests })
  }

  const suggestions = INTEREST_SUGGESTIONS.filter((s) => !value.interests.some((i) => i.toLowerCase() === s.toLowerCase()))

  return (
    <form className="space-y-5" onSubmit={submit}>
      <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
        <Field label="Tên gọi ở nhà" hint={`Bin sẽ gọi con bằng tên này trong lúc tập. Để trống thì Bin gọi là “con”.`}>
          <input
            className="input-duo"
            value={value.nickname ?? ''}
            maxLength={NICKNAME_MAX}
            placeholder="Ví dụ: Bống, Tí"
            onChange={(e) => set('nickname', e.target.value || null)}
          />
        </Field>

        <Field label="Cách con giao tiếp chủ yếu">
          <select
            className="input-duo"
            value={value.communication ?? ''}
            onChange={(e) => set('communication', (e.target.value || null) as CommunicationLevel | null)}
          >
            <option value="">Chưa chọn</option>
            {(Object.keys(COMMUNICATION_LABEL) as CommunicationLevel[]).map((level) => (
              <option key={level} value={level}>
                {COMMUNICATION_LABEL[level]}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <Field label={`${childName} thích gì?`} hint={`Tối đa ${INTEREST_MAX_COUNT} mục. Bấm vào gợi ý hoặc tự gõ rồi nhấn Enter.`}>
        {value.interests.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-2">
            {value.interests.map((interest) => (
              <span
                key={interest}
                className="inline-flex items-center gap-1 rounded-full bg-duo-green-soft py-1 pl-3 pr-1.5 text-xs font-extrabold text-duo-green-dark"
              >
                {interest}
                <button
                  type="button"
                  aria-label={`Bỏ ${interest}`}
                  className="rounded-full p-0.5 hover:bg-white/70"
                  onClick={() => set('interests', value.interests.filter((i) => i !== interest))}
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
          </div>
        )}
        <div className="flex gap-2">
          <input
            className="input-duo"
            value={interestDraft}
            maxLength={INTEREST_MAX_LENGTH}
            placeholder="Thêm sở thích của con"
            onChange={(e) => setInterestDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== 'Enter') return
              e.preventDefault()
              addInterest(interestDraft)
            }}
          />
          <button type="button" className="btn-duo-secondary !px-3" aria-label="Thêm sở thích" onClick={() => addInterest(interestDraft)}>
            <Plus className="h-4 w-4" />
          </button>
        </div>
        {suggestions.length > 0 && value.interests.length < INTEREST_MAX_COUNT && (
          <div className="mt-2 flex flex-wrap gap-2">
            {suggestions.map((s) => (
              <Chip key={s} active={false} onClick={() => addInterest(s)}>
                + {s}
              </Chip>
            ))}
          </div>
        )}
      </Field>

      <Field
        label="Điều con dễ khó chịu"
        hint="Nếu chọn “Âm thanh lớn”, Bin sẽ chỉ nhắc bằng chữ trong lúc tập, không nói thành tiếng."
      >
        <div className="flex flex-wrap gap-2">
          {SENSORY_ORDER.map((tag: SensoryTag) => (
            <Chip key={tag} active={value.sensory.includes(tag)} onClick={() => set('sensory', toggle(value.sensory, tag))}>
              {SENSORY_LABEL[tag]}
            </Chip>
          ))}
        </div>
      </Field>

      <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
        <Field label="Điều giúp con bình tĩnh lại">
          <textarea
            className="input-duo min-h-[84px]"
            value={value.calming ?? ''}
            maxLength={FREE_TEXT_MAX}
            placeholder="Ví dụ: ôm gấu bông, nghe bài hát quen, ngồi góc yên tĩnh"
            onChange={(e) => set('calming', e.target.value || null)}
          />
        </Field>
        <Field label="Điều bố mẹ mong con làm được">
          <textarea
            className="input-duo min-h-[84px]"
            value={value.goals ?? ''}
            maxLength={FREE_TEXT_MAX}
            placeholder="Ví dụ: con bắt chước được động tác tay, tập đều mỗi tuần"
            onChange={(e) => set('goals', e.target.value || null)}
          />
        </Field>
      </div>

      <div className="rounded-2xl bg-duo-mist/70 p-4">
        <div className="mb-3 text-sm font-extrabold text-duo-ink">Khi con tập cùng bạn Bin</div>
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
          <Field label="Ưu tiên luyện" hint="Gợi ý bài tập sẽ ưu tiên các phần này.">
            <div className="flex flex-wrap gap-2">
              {FOCUS_ORDER.map((area: BodyFocus) => (
                <Chip key={area} active={value.focusAreas.includes(area)} onClick={() => set('focusAreas', toggle(value.focusAreas, area))}>
                  {BODY_FOCUS_LABEL[area]}
                </Chip>
              ))}
            </div>
          </Field>
          <Field label="Mục tiêu mỗi tuần">
            <select
              className="input-duo"
              value={value.weeklyGoal ?? ''}
              onChange={(e) => set('weeklyGoal', e.target.value ? Number(e.target.value) : null)}
            >
              <option value="">Chưa đặt</option>
              {[1, 2, 3, 4, 5, 6, 7].map((n) => (
                <option key={n} value={n}>
                  {n} ngày tập mỗi tuần
                </option>
              ))}
            </select>
          </Field>
          <Field label="Tốc độ Bin làm mẫu">
            <select className="input-duo" value={value.guideSpeed} onChange={(e) => set('guideSpeed', e.target.value as GuideSpeed)}>
              {(Object.keys(GUIDE_SPEED_LABEL) as GuideSpeed[]).map((speed) => (
                <option key={speed} value={speed}>
                  {GUIDE_SPEED_LABEL[speed]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Cách tập">
            <select
              className="input-duo"
              value={value.practiceMode}
              onChange={(e) => set('practiceMode', e.target.value as PracticeModePref)}
            >
              {(Object.keys(PRACTICE_PREF_LABEL) as PracticeModePref[]).map((mode) => (
                <option key={mode} value={mode}>
                  {PRACTICE_PREF_LABEL[mode]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Bin nhắc con trong lúc tập" hint="Chỉ có ở một số bài; hình ảnh được phân tích ngay trên máy, không gửi đi.">
            <select
              className="input-duo"
              value={value.liveCoach === null ? '' : value.liveCoach ? 'on' : 'off'}
              onChange={(e) => set('liveCoach', e.target.value === '' ? null : e.target.value === 'on')}
            >
              <option value="">Tự động (bật)</option>
              <option value="on">Luôn bật</option>
              <option value="off">Tắt</option>
            </select>
          </Field>
        </div>
      </div>

      {error && <div className="rounded-2xl bg-red-50 px-4 py-3 text-sm font-bold text-duo-red">{error}</div>}

      <div className="flex flex-wrap gap-3">
        <button type="submit" className="btn-duo" disabled={saving}>
          {saving && <Loader2 className="h-4 w-4 animate-spin" />}
          Lưu
        </button>
        <button type="button" className="btn-duo-secondary" disabled={saving} onClick={onCancel}>
          Huỷ
        </button>
      </div>
    </form>
  )
}

/**
 * "Cá nhân hoá" card of a child's dashboard: what the parent told the app
 * about the child, used to adapt the exercises (never for screening).
 */
export function ChildPersonalizationSection({
  childId,
  childName,
  onSaved,
}: {
  childId: string
  childName: string
  /** Called after a save so other sections (practice plan) can refresh. */
  onSaved?: () => void
}) {
  const [state, setState] = useState<SectionState>({ kind: 'loading' })
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    fetchPersonalization(childId).then(
      (data) => active && setState({ kind: 'ready', ...data }),
      (error: unknown) => {
        if (!active) return
        const code = apiErrorCode(error)
        if (code === 'DATABASE_MIGRATION_REQUIRED') setState({ kind: 'migration' })
        // A backend without this feature answers a bare 404: nothing to show.
        else if (!code) setState({ kind: 'hidden' })
        else setState({ kind: 'error', message: personalizationErrorMessage(error, 'Không tải được phần cá nhân hoá.') })
      },
    )
    return () => {
      active = false
    }
  }, [childId])

  if (state.kind === 'hidden') return null

  const title = (
    <span className="flex items-center gap-2">
      <Sparkles className="h-4 w-4 text-duo-green-dark" />
      Cá nhân hoá cho {childName}
    </span>
  )

  if (state.kind === 'loading') {
    return (
      <Card title={title}>
        <div className="flex items-center gap-2 text-sm font-semibold text-duo-mute">
          <Loader2 className="h-4 w-4 animate-spin" />
          Đang tải...
        </div>
      </Card>
    )
  }

  if (state.kind === 'migration' || state.kind === 'error') {
    return (
      <Card title={title}>
        <div className="flex items-start gap-2 rounded-2xl bg-duo-mist px-4 py-3 text-sm font-semibold text-duo-mute">
          <Info className="mt-0.5 h-4 w-4 flex-shrink-0" />
          {state.kind === 'migration'
            ? 'Phần cá nhân hoá đang được chuẩn bị trên máy chủ và sẽ sớm mở. Các thông tin khác của hồ sơ không bị ảnh hưởng.'
            : state.message}
        </div>
      </Card>
    )
  }

  const p = state.personalization

  async function save(input: PersonalizationInput) {
    setSaving(true)
    setFormError(null)
    try {
      const saved = await savePersonalization(childId, input)
      setState({ kind: 'ready', ...saved })
      setEditing(false)
      onSaved?.()
    } catch (error) {
      setFormError(personalizationErrorMessage(error, 'Chưa lưu được. Vui lòng thử lại.'))
    } finally {
      setSaving(false)
    }
  }

  const editButton = !editing && (
    <button type="button" className="link-duo flex items-center gap-1 text-xs" onClick={() => setEditing(true)}>
      <Pencil className="h-3.5 w-3.5" />
      {state.empty ? 'Thiết lập' : 'Sửa'}
    </button>
  )

  return (
    <Card title={title} right={editButton}>
      {editing ? (
        <PersonalizationForm
          childName={childName}
          initial={state.empty ? EMPTY_PERSONALIZATION : toInput(p)}
          saving={saving}
          error={formError}
          onCancel={() => {
            setEditing(false)
            setFormError(null)
          }}
          onSubmit={(value) => void save(value)}
        />
      ) : state.empty ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="max-w-2xl text-sm font-semibold leading-relaxed text-duo-ink">
            Kể cho Bin nghe về {childName}: tên gọi ở nhà, điều con thích, điều con dễ khó chịu và mong muốn của bố mẹ. Bin sẽ làm
            mẫu, nhắc và gợi ý bài tập cho hợp với con hơn.
          </p>
          <button type="button" className="btn-duo" onClick={() => setEditing(true)}>
            <Sparkles className="h-4 w-4" />
            Thiết lập cho {childName}
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <SummaryItem label="Tên gọi ở nhà">{p.nickname ?? '—'}</SummaryItem>
            <SummaryItem label="Cách giao tiếp">{p.communication ? COMMUNICATION_LABEL[p.communication] : '—'}</SummaryItem>
            <SummaryItem label="Mục tiêu mỗi tuần">{p.weeklyGoal ? `${p.weeklyGoal} ngày tập` : '—'}</SummaryItem>
            <SummaryItem label="Con thích">{p.interests.length ? p.interests.join(', ') : '—'}</SummaryItem>
            <SummaryItem label="Con dễ khó chịu với">
              {p.sensory.length ? p.sensory.map((tag) => SENSORY_LABEL[tag]).join(', ') : '—'}
            </SummaryItem>
            <SummaryItem label="Ưu tiên luyện">
              {p.focusAreas.length ? p.focusAreas.map((area) => BODY_FOCUS_LABEL[area]).join(', ') : '—'}
            </SummaryItem>
            {p.calming && <SummaryItem label="Giúp con bình tĩnh">{p.calming}</SummaryItem>}
            {p.goals && <SummaryItem label="Bố mẹ mong con">{p.goals}</SummaryItem>}
            <SummaryItem label="Khi tập cùng Bin">
              Tốc độ: {GUIDE_SPEED_LABEL[p.guideSpeed].toLowerCase()} • Cách tập: {PRACTICE_PREF_LABEL[p.practiceMode].toLowerCase()} •
              Bin nhắc: {p.liveCoach === false ? 'tắt' : 'bật'}
            </SummaryItem>
          </div>
          {p.updatedAt && <div className="text-xs font-bold text-duo-mute">Cập nhật ngày {formatDate(p.updatedAt)}</div>}
        </div>
      )}
      <p className="mt-4 text-xs font-semibold leading-relaxed text-duo-mute">{PERSONALIZATION_NOTE}</p>
    </Card>
  )
}
