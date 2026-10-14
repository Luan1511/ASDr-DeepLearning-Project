import { useEffect, useState, type ReactNode } from 'react'
import { CheckCircle2, CircleAlert, XCircle } from 'lucide-react'
import { Card } from '../Card'
import { BAND_LABEL, fetchAdminQuestionnaireStatus, questionnaireUnavailableReason } from '../../lib/questionnaires'
import type { AdminQuestionnaireStatusDto, McHatContentState, QuestionnaireServerMode } from '../../lib/questionnaireTypes'

const MODE_LABEL: Record<QuestionnaireServerMode, string> = {
  off: 'off — đang tắt (chỉ xem/xoá kết quả cũ)',
  entry: 'entry — nhập theo số câu từ phiếu chính thức',
  inapp: 'inapp — trả lời trong ứng dụng (khi nội dung sẵn sàng)',
}

const CONTENT_LABEL: Record<McHatContentState, string> = {
  missing: 'Chưa có file nội dung',
  invalid: 'File nội dung chưa hợp lệ',
  ready: 'Nội dung sẵn sàng',
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-2xl bg-duo-mist px-3 py-2">
      <div className="text-[11px] font-extrabold uppercase tracking-wide text-duo-mute">{label}</div>
      <div className="text-xl font-black tabular-nums text-duo-ink">{value}</div>
    </div>
  )
}

function Line({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="text-sm font-bold text-duo-ink">
      <span className="text-duo-mute">{label}: </span>
      {children}
    </div>
  )
}

type State = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; data: AdminQuestionnaireStatusDto }

/**
 * Admin "Bảng hỏi" card: MCHAT_MODE, state of the licensed content file and aggregate counts only
 * (never answers or child names), plus how to install the content.
 */
export function AdminQuestionnaireStatusCard() {
  const [state, setState] = useState<State>({ status: 'loading' })

  useEffect(() => {
    let stale = false
    fetchAdminQuestionnaireStatus().then(
      (data) => !stale && setState({ status: 'ready', data }),
      (e) =>
        !stale &&
        setState({
          status: 'error',
          message:
            questionnaireUnavailableReason(e) === 'absent'
              ? 'Máy chủ chưa có API trạng thái bảng hỏi (/admin/questionnaires/status).'
              : 'Không tải được trạng thái bảng hỏi.',
        }),
    )
    return () => {
      stale = true
    }
  }, [])

  return (
    <Card title="Bảng hỏi (M-CHAT-R/F)">
      {state.status === 'loading' && <div className="text-sm font-semibold text-duo-mute">Đang tải...</div>}
      {state.status === 'error' && (
        <div className="rounded-2xl bg-red-50 px-4 py-3 text-sm font-bold text-duo-red">{state.message}</div>
      )}
      {state.status === 'ready' && <StatusBody data={state.data} />}
      <HowTo />
    </Card>
  )
}

function StatusBody({ data }: { data: AdminQuestionnaireStatusDto }) {
  const { content, counts } = data
  const fileName = content.file || content.path || null
  const Icon = content.state === 'ready' ? CheckCircle2 : content.state === 'invalid' ? XCircle : CircleAlert
  const iconCls = content.state === 'ready' ? 'text-duo-green' : content.state === 'invalid' ? 'text-duo-red' : 'text-yellow-600'
  const inAppActive = data.mode === 'inapp' && content.state === 'ready'
  const stage1Only = data.mode === 'inapp' && content.state !== 'ready' && content.stage1Ready === true

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Line label="MCHAT_MODE">{MODE_LABEL[data.mode] ?? data.mode}</Line>
        <div className="flex items-center gap-2 text-sm font-bold text-duo-ink">
          <Icon className={`h-4 w-4 ${iconCls}`} aria-hidden="true" />
          {CONTENT_LABEL[content.state] ?? content.state}
          {fileName && <span className="font-semibold text-duo-mute">({fileName})</span>}
        </div>
        {stage1Only && (
          <div className="rounded-2xl bg-yellow-50 px-4 py-2 text-xs font-bold text-yellow-800">
            Phần 1 (20 câu) đang hỏi trong app; phần hỏi thêm (Follow-Up) chưa có nội dung nên vẫn nhập theo kết quả làm cùng nhân viên y tế.
          </div>
        )}
        {data.mode === 'inapp' && !inAppActive && !stage1Only && (
          <div className="rounded-2xl bg-yellow-50 px-4 py-2 text-xs font-bold text-yellow-800">
            Chế độ inapp nhưng nội dung chưa sẵn sàng: phụ huynh đang dùng cách nhập theo phiếu giấy (như chế độ entry).
          </div>
        )}
        {content.contentVersion && <Line label="Phiên bản nội dung">{content.contentVersion}</Line>}
        {content.translationSource && <Line label="Nguồn bản dịch">{content.translationSource}</Line>}
        {content.licenseRef && <Line label="Giấy phép (licenseRef)">{content.licenseRef}</Line>}
        {content.structureHash && (
          <Line label="Structure hash">
            <code className="text-xs">{content.structureHash}</code>
          </Line>
        )}
      </div>

      {content.errors.length > 0 && (
        <div className="rounded-2xl bg-red-50 px-4 py-3">
          <div className="text-xs font-extrabold uppercase tracking-wide text-duo-red">Lỗi kiểm tra nội dung ({content.errors.length})</div>
          <ul className="mt-1 max-h-48 list-disc space-y-0.5 overflow-auto pl-5 text-xs font-semibold text-duo-red">
            {content.errors.map((err, i) => (
              <li key={`${i}-${err}`} className="break-words">
                {err}
              </li>
            ))}
          </ul>
        </div>
      )}

      {counts ? (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
            <Stat label="Tổng lần trả lời" value={counts.total} />
            <Stat label={BAND_LABEL.LOW} value={counts.byBand.LOW} />
            <Stat label={BAND_LABEL.MODERATE} value={counts.byBand.MODERATE} />
            <Stat label={BAND_LABEL.HIGH} value={counts.byBand.HIGH} />
            <Stat label="Chờ hỏi thêm" value={counts.followUpPending} />
            <Stat label="Trả lời trong app" value={counts.inApp} />
          </div>
          <p className="text-xs font-semibold text-duo-mute">Chỉ số tổng hợp — không có câu trả lời hay tên trẻ.</p>
        </>
      ) : (
        <div className="rounded-2xl bg-yellow-50 px-4 py-2 text-xs font-bold text-yellow-800">
          Chưa thống kê được số lần trả lời: cơ sở dữ liệu chưa có bảng QuestionnaireResponse (cần áp dụng migration bảng hỏi).
        </div>
      )}
    </div>
  )
}

function HowTo() {
  return (
    <details className="mt-4 rounded-2xl bg-duo-mist px-4 py-3">
      <summary className="cursor-pointer text-sm font-extrabold text-duo-ink">Cách bật bảng hỏi trong ứng dụng</summary>
      <ol className="mt-2 list-decimal space-y-1.5 pl-5 text-xs font-semibold leading-relaxed text-duo-ink">
        <li>
          <strong>Chỉ làm sau khi có văn bản cho phép của tác giả M-CHAT-R/F</strong> (sử dụng điện tử cần xin phép, kể cả phi thương
          mại). Ghi mã/ngày thư cho phép vào trường <code>licenseRef</code>.
        </li>
        <li>
          Sao chép <code>backend/content/mchat-rf.template.json</code> thành <code>backend/content/mchat-rf.vi.json</code> (hoặc đường
          dẫn trong <code>MCHAT_CONTENT_PATH</code>) và điền nội dung từ bản tiếng Việt chính thức được cấp phép. Không sửa id, cấu trúc
          hay <code>structureHash</code>.
        </li>
        <li>
          Kiểm tra: <code>cd backend &amp;&amp; npx tsx scripts/validateMchatContent.ts [đường dẫn]</code> (chỉ in trạng thái và lỗi,
          không in nội dung).
        </li>
        <li>
          Đặt <code>MCHAT_MODE=inapp</code> trong <code>backend/.env</code> rồi khởi động lại backend. File nội dung không được commit
          (đã nằm trong .gitignore).
        </li>
      </ol>
    </details>
  )
}
