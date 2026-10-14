import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Info, Loader2, UserPlus } from 'lucide-react'
import { DashboardLayout } from '../layouts/DashboardLayout'
import { Card } from '../components/Card'
import { ChildAvatar } from '../components/ChildAvatar'
import { ExerciseCard } from '../components/exercise/ExerciseCard'
import { ExerciseConsentPanel } from '../components/exercise/ExerciseConsentPanel'
import { PendingResultsTray } from '../components/exercise/PendingResultsTray'
import { api } from '../lib/api'
import { childApiErrorMessage } from '../lib/children'
import { EXERCISE_DISCLAIMER, exerciseApiErrorMessage, fetchExerciseConsent, fetchExercises } from '../lib/exercises'
import type { ExerciseConsentStatus, ExerciseSummaryDto } from '../lib/exerciseTypes'
import type { ChildProfile } from '../lib/types'
import { useExerciseCapabilities } from '../lib/useExerciseCapabilities'

type Keyed<T> = { childId: string; value: T }

/** Exercise library: choose a child, confirm recording consent, pick an exercise. */
export function ExercisesPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const requestedChildId = searchParams.get('childId')
  const caps = useExerciseCapabilities()

  const [children, setChildren] = useState<ChildProfile[] | null>(null)
  const [childrenError, setChildrenError] = useState<string | null>(null)
  const [exercises, setExercises] = useState<Keyed<ExerciseSummaryDto[]> | null>(null)
  const [exercisesError, setExercisesError] = useState<Keyed<string> | null>(null)
  const [consent, setConsent] = useState<Keyed<ExerciseConsentStatus> | null>(null)

  useEffect(() => {
    api.get('/children').then(
      (res) => setChildren(res.data.children ?? []),
      (e: unknown) => {
        setChildrenError(childApiErrorMessage(e, 'Không tải được danh sách hồ sơ trẻ.'))
        setChildren([])
      },
    )
  }, [])

  // An unknown ?childId= falls back to the first child.
  const child = children?.find((c) => c.id === requestedChildId) ?? children?.[0] ?? null
  const childId = child?.id ?? null

  useEffect(() => {
    if (!childId) return
    let stale = false
    fetchExercises(childId).then(
      (list) => !stale && setExercises({ childId, value: list }),
      (e: unknown) =>
        !stale && setExercisesError({ childId, value: exerciseApiErrorMessage(e, 'Không tải được danh sách bài tập.') }),
    )
    fetchExerciseConsent(childId).then(
      (status) => !stale && setConsent({ childId, value: status }),
      () => !stale && setConsent({ childId, value: { currentVersion: '', consent: null, lastRevokedAt: null } }),
    )
    return () => {
      stale = true
    }
  }, [childId])

  const list = exercises?.childId === childId ? exercises.value : null
  const listError = exercisesError?.childId === childId ? exercisesError.value : null
  const consentStatus = consent?.childId === childId ? consent.value : null
  const hasConsent = Boolean(consentStatus?.consent)

  function selectChild(id: string) {
    setSearchParams({ childId: id }, { replace: true })
  }

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-black text-duo-ink">Bài tập vận động</h1>
          <p className="mt-1 text-sm font-semibold text-duo-mute">
            Con xem bạn Mầm làm mẫu rồi bắt chước theo. Mỗi bài chỉ khoảng 10–30 giây.
          </p>
        </div>

        {caps && !caps.mlReachable && (
          <div className="flex items-start gap-2 rounded-2xl bg-yellow-50 px-4 py-3 text-sm font-semibold text-yellow-900">
            <Info className="mt-0.5 h-4 w-4 flex-shrink-0" />
            Máy phân tích đang tạm ngắt kết nối. Con vẫn tập được; bài sẽ được chấm khi máy hoạt động lại.
          </div>
        )}

        {childrenError && <div className="rounded-2xl bg-red-50 px-4 py-3 text-sm font-bold text-duo-red">{childrenError}</div>}

        {children === null && (
          <div className="flex items-center gap-2 text-sm font-semibold text-duo-mute">
            <Loader2 className="h-4 w-4 animate-spin" />
            Đang tải...
          </div>
        )}

        {children && children.length === 0 && !childrenError && (
          <div className="card-duo px-6 py-10 text-center">
            <div className="text-base font-black text-duo-ink">Chưa có hồ sơ trẻ nào</div>
            <p className="mx-auto mt-1 max-w-md text-sm font-semibold text-duo-mute">
              Tạo hồ sơ cho con trước, rồi quay lại đây để cùng con tập với bạn Mầm.
            </p>
            <Link to="/children" className="btn-duo mt-5">
              <UserPlus className="h-4 w-4" />
              Tạo hồ sơ trẻ
            </Link>
          </div>
        )}

        {child && (
          <>
            <Card title="Tập cho">
              <div className="space-y-4">
                <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Chọn hồ sơ trẻ">
                  {(children ?? []).map((c) => {
                    const selected = c.id === child.id
                    return (
                      <button
                        key={c.id}
                        type="button"
                        role="radio"
                        aria-checked={selected}
                        onClick={() => selectChild(c.id)}
                        className={[
                          'flex items-center gap-2 rounded-full py-1 pl-1 pr-4 text-sm font-extrabold transition-all',
                          selected ? 'bg-duo-green-soft text-duo-green-dark shadow-ring-green' : 'bg-duo-mist text-duo-mute hover:text-duo-ink',
                        ].join(' ')}
                      >
                        <ChildAvatar name={c.fullName} />
                        {c.fullName}
                      </button>
                    )
                  })}
                </div>
                <ExerciseConsentPanel
                  childId={child.id}
                  childName={child.fullName}
                  status={consentStatus}
                  onChange={(value) => setConsent({ childId: child.id, value })}
                />
              </div>
            </Card>

            <PendingResultsTray childId={child.id} />

            {listError && <div className="rounded-2xl bg-red-50 px-4 py-3 text-sm font-bold text-duo-red">{listError}</div>}

            {!list && !listError && (
              <div className="flex items-center gap-2 text-sm font-semibold text-duo-mute">
                <Loader2 className="h-4 w-4 animate-spin" />
                Đang tải bài tập...
              </div>
            )}

            {list && list.length === 0 && (
              <div className="card-duo px-6 py-8 text-center text-sm font-semibold text-duo-mute">
                Hiện chưa có bài tập nào được mở. Vui lòng quay lại sau.
              </div>
            )}

            {list && list.length > 0 && (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 2xl:grid-cols-3">
                {list.map((exercise) => (
                  <ExerciseCard
                    key={exercise.id}
                    exercise={exercise}
                    childId={child.id}
                    disabledReason={
                      consentStatus && !hasConsent ? 'Bật quyền ghi hình bài tập ở phía trên để bắt đầu tập.' : null
                    }
                  />
                ))}
              </div>
            )}
          </>
        )}

        <p className="text-xs font-semibold leading-relaxed text-duo-mute">{EXERCISE_DISCLAIMER}</p>
      </div>
    </DashboardLayout>
  )
}
