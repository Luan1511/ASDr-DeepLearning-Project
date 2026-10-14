import { useEffect, useState } from 'react'
import { Info, Loader2, ShieldCheck } from 'lucide-react'
import { ConsentPanel } from '../ConsentPanel'
import { apiErrorCode } from '../../lib/api'
import {
  exerciseApiErrorMessage,
  fetchExerciseConsentStatement,
  grantExerciseConsent,
  revokeExerciseConsent,
} from '../../lib/exercises'
import type { ExerciseConsentStatus } from '../../lib/exerciseTypes'
import type { ConsentStatement } from '../../lib/types'
import { formatDate } from '../../lib/format'

const REVOKED_NOTICE =
  'Quyền ghi hình bài tập của con đã được tắt (do bạn thu hồi, hoặc do đồng ý sàng lọc được cập nhật trên một phiên bản cũ của hệ thống). Vui lòng xác nhận lại để tiếp tục.'

/**
 * Exercise recording consent of one child (separate from the screening consent).
 * Shows the granted state with a revoke link, or the statement to accept.
 */
export function ExerciseConsentPanel({
  childId,
  childName,
  status,
  onChange,
}: {
  childId: string
  childName: string
  /** null while loading. */
  status: ExerciseConsentStatus | null
  onChange: (status: ExerciseConsentStatus) => void
}) {
  const needsStatement = status !== null && status.consent === null
  const [statement, setStatement] = useState<ConsentStatement | null>(null)
  const [statementError, setStatementError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!needsStatement || statement) return
    let stale = false
    fetchExerciseConsentStatement().then(
      (s) => !stale && setStatement(s),
      (e: unknown) => !stale && setStatementError(exerciseApiErrorMessage(e, 'Không tải được nội dung xác nhận đồng ý.')),
    )
    return () => {
      stale = true
    }
  }, [needsStatement, statement])

  async function accept() {
    if (!statement) return
    setSaving(true)
    setError(null)
    try {
      const consent = await grantExerciseConsent(childId, statement.version)
      onChange({ currentVersion: statement.version, consent, lastRevokedAt: status?.lastRevokedAt ?? null })
    } catch (e) {
      if (apiErrorCode(e) === 'CONSENT_VERSION_OUTDATED') {
        const fresh = await fetchExerciseConsentStatement().catch(() => null)
        if (fresh) setStatement(fresh)
      }
      setError(exerciseApiErrorMessage(e, 'Không lưu được xác nhận đồng ý. Vui lòng thử lại.'))
    } finally {
      setSaving(false)
    }
  }

  async function revoke() {
    if (!status?.consent) return
    if (!window.confirm('Thu hồi quyền ghi hình bài tập? Các bài đang chờ chấm sẽ không được phân tích và video sẽ được xoá.')) return
    setError(null)
    try {
      await revokeExerciseConsent(childId)
      onChange({ ...status, consent: null, lastRevokedAt: new Date().toISOString() })
    } catch (e) {
      setError(exerciseApiErrorMessage(e, 'Không thu hồi được đồng ý. Vui lòng thử lại.'))
    }
  }

  if (status === null) {
    return (
      <div className="flex items-center gap-2 text-xs font-bold text-duo-mute">
        <Loader2 className="h-4 w-4 animate-spin" />
        Đang kiểm tra quyền ghi hình bài tập...
      </div>
    )
  }

  if (status.consent) {
    return (
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2 text-xs font-bold text-duo-green-dark">
          <ShieldCheck className="h-4 w-4 stroke-[2.5]" />
          <span>Đã bật quyền ghi hình bài tập cho {childName} từ {formatDate(status.consent.grantedAt)}.</span>
          <button type="button" className="link-duo text-xs" onClick={revoke}>
            Thu hồi
          </button>
        </div>
        {error && <div className="rounded-2xl bg-red-50 px-4 py-3 text-sm font-bold text-duo-red">{error}</div>}
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {status.lastRevokedAt && (
        <div className="flex items-start gap-2 rounded-2xl bg-yellow-50 px-4 py-3 text-sm font-semibold leading-relaxed text-yellow-900">
          <Info className="mt-0.5 h-4 w-4 flex-shrink-0 stroke-[2.5]" />
          <span>{REVOKED_NOTICE}</span>
        </div>
      )}
      {statement ? (
        <ConsentPanel
          statement={statement}
          childName={childName}
          submitting={saving}
          onAccept={() => void accept()}
          requiredScopes={['EXERCISE_VIDEO']}
        />
      ) : statementError ? (
        <div className="rounded-2xl bg-red-50 px-4 py-3 text-sm font-bold text-duo-red">{statementError}</div>
      ) : (
        <div className="flex items-center gap-2 text-xs font-bold text-duo-mute">
          <Loader2 className="h-4 w-4 animate-spin" />
          Đang tải nội dung xác nhận đồng ý...
        </div>
      )}
      {error && <div className="rounded-2xl bg-red-50 px-4 py-3 text-sm font-bold text-duo-red">{error}</div>}
    </div>
  )
}
