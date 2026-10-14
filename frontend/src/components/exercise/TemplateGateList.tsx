import { CheckCircle2, Info, XCircle } from 'lucide-react'
import type { TemplateGateDto, TemplateSelfTestDto } from '../../lib/exerciseTypes'
import { formatNumber } from '../../lib/format'

/** Admin wording of the template quality gates (backend imitation/template.ts). */
const GATE_LABEL: Record<string, { label: string; hint: string }> = {
  TEMPLATE_FPS_REQUIRED: {
    label: 'Xác định được tốc độ khung hình',
    hint: 'Nếu máy phân tích không báo fps, hãy nhập fps của video mẫu.',
  },
  TEMPLATE_PERSON_COVERAGE: {
    label: 'Người làm mẫu có mặt gần như suốt video',
    hint: 'Chỉ một người lớn trong khung hình, thấy cả người từ đầu đến chân.',
  },
  TEMPLATE_NO_NEUTRAL_START: {
    label: 'Đứng yên ở đầu video',
    hint: 'Đứng yên tư thế nghỉ khoảng 1 giây trước khi bắt đầu động tác.',
  },
  TEMPLATE_ACTIVE_DURATION: {
    label: 'Đoạn động tác dài 2–30 giây',
    hint: 'Điều chỉnh đoạn cắt hoặc quay lại với động tác vừa phải.',
  },
  TEMPLATE_NO_ACTIVE_PART: {
    label: 'Có ít nhất một bộ phận cử động rõ',
    hint: 'Biên độ động tác cần đủ lớn (từ khoảng 20° trở lên).',
  },
  TEMPLATE_PART_NOT_VISIBLE: {
    label: 'Bộ phận cử động luôn nhìn rõ',
    hint: 'Tay/chân đang làm động tác không bị che hoặc ra khỏi khung hình.',
  },
  TEMPLATE_NOT_FACING: {
    label: 'Đứng quay mặt về phía camera',
    hint: 'Đứng chính diện, không quay ngang.',
  },
}

function gateValue(value: number | null) {
  if (value === null || !Number.isFinite(value)) return '—'
  return formatNumber(value, Math.abs(value) < 10 ? 2 : 1)
}

function SelfTestRow({ label, value, expect, ok }: { label: string; value: number | null; expect: string; ok: boolean | null }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl bg-white px-3 py-2 shadow-chip">
      <div className="min-w-0">
        <div className="text-sm font-extrabold text-duo-ink">{label}</div>
        <div className="text-xs font-bold text-duo-mute">{expect}</div>
      </div>
      <div className="flex items-center gap-1.5">
        <span className="text-lg font-black tabular-nums text-duo-ink">{value ?? '—'}</span>
        {ok === true && <CheckCircle2 className="h-4 w-4 text-duo-green" aria-label="Đạt kỳ vọng" />}
        {ok === false && <XCircle className="h-4 w-4 text-duo-red" aria-label="Chưa đạt kỳ vọng" />}
      </div>
    </div>
  )
}

/** Quality gates (pass/fail with measured value) and the self-test of a template build. */
export function TemplateGateList({
  gates,
  selfTest,
  compact = false,
}: {
  gates: TemplateGateDto[]
  selfTest?: TemplateSelfTestDto | null
  /** Hides the per-gate hint lines. */
  compact?: boolean
}) {
  const failed = gates.filter((g) => !g.ok).length
  return (
    <div className="space-y-3">
      <div
        className={[
          'flex items-center gap-2 rounded-2xl px-3 py-2 text-sm font-extrabold',
          gates.length === 0
            ? 'bg-duo-mist text-duo-mute'
            : failed === 0
              ? 'bg-duo-green-soft text-duo-green-dark'
              : 'bg-red-50 text-duo-red',
        ].join(' ')}
        role="status"
      >
        {gates.length === 0 ? (
          <Info className="h-4 w-4" />
        ) : failed === 0 ? (
          <CheckCircle2 className="h-4 w-4" />
        ) : (
          <XCircle className="h-4 w-4" />
        )}
        {gates.length === 0
          ? 'Chưa có kết quả kiểm tra chất lượng.'
          : failed === 0
            ? `Đạt cả ${gates.length} tiêu chí chất lượng`
            : `Chưa đạt ${failed}/${gates.length} tiêu chí chất lượng`}
      </div>

      {gates.length > 0 && (
        <ul className="space-y-1.5">
          {gates.map((g) => {
            const text = GATE_LABEL[g.code] ?? { label: g.code, hint: '' }
            return (
              <li key={g.code} className="flex items-start gap-2 rounded-xl px-2 py-1.5">
                {g.ok ? (
                  <CheckCircle2 className="mt-0.5 h-4 w-4 flex-shrink-0 text-duo-green" aria-label="Đạt" />
                ) : (
                  <XCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-duo-red" aria-label="Chưa đạt" />
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                    <span className={['text-sm font-extrabold', g.ok ? 'text-duo-ink' : 'text-duo-red'].join(' ')}>
                      {text.label}
                    </span>
                    <span className="text-xs font-bold tabular-nums text-duo-mute">
                      đo được {gateValue(g.value)} • yêu cầu {g.threshold}
                    </span>
                  </div>
                  {!compact && !g.ok && text.hint && <div className="text-xs font-semibold text-duo-mute">{text.hint}</div>}
                </div>
              </li>
            )
          })}
        </ul>
      )}

      {selfTest && (
        <div className="space-y-2 rounded-2xl bg-duo-mist p-3">
          <div className="text-xs font-extrabold uppercase tracking-wide text-duo-mute">Tự kiểm tra bộ chấm</div>
          <div className="grid gap-2 sm:grid-cols-3">
            <SelfTestRow
              label="Chính video mẫu"
              value={selfTest.identical}
              expect="Kỳ vọng ≥ 90"
              ok={selfTest.identical === null ? null : selfTest.identical >= 90}
            />
            <SelfTestRow
              label="Video mẫu lật gương"
              value={selfTest.mirrored}
              expect="Tham khảo (phụ thuộc chính sách soi gương)"
              ok={null}
            />
            <SelfTestRow
              label="Đứng yên"
              value={selfTest.still}
              expect="Kỳ vọng ≤ 20"
              ok={selfTest.still === null ? null : selfTest.still <= 20}
            />
          </div>
        </div>
      )}
    </div>
  )
}
