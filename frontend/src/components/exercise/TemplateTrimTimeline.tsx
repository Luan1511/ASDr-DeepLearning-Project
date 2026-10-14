import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { Pause, Play, RotateCcw } from 'lucide-react'
import { GuidePuppet, type GuidePuppetProps } from './GuidePuppet'
import { formatNumber } from '../../lib/format'

export type TrimRange = { startSec: number; endSec: number }

// Shorter than the 2 s duration gate on purpose: the gate list, not the
// slider, is what tells the admin the segment is too short.
const MIN_SPAN_SEC = 0.5
const STEP_SEC = 0.05
const KEY_STEP_SEC = 0.1
const KEY_STEP_LARGE_SEC = 1
const SAME_TRIM_TOLERANCE_SEC = 0.05
const ACCENT = '#166534'

const round = (sec: number) => Math.round(sec / STEP_SEC) * STEP_SEC
const secText = (sec: number) => `${formatNumber(sec, 2)} s`

function tickStep(durationSec: number) {
  const raw = durationSec / 6
  for (const step of [0.5, 1, 2, 5, 10, 15, 30]) if (raw <= step) return step
  return 60
}

function sameTrim(a: TrimRange | null, b: TrimRange | null) {
  if (!a || !b) return false
  return Math.abs(a.startSec - b.startSec) <= SAME_TRIM_TOLERANCE_SEC && Math.abs(a.endSec - b.endSec) <= SAME_TRIM_TOLERANCE_SEC
}

type Handle = 'start' | 'end'

/**
 * Admin trim of a demonstration: start/end handles over the clip, the
 * algorithm's suggested segment underneath, and a puppet preview of the
 * segment compiled by the last dry run.
 */
export function TemplateTrimTimeline({
  clipDurationSec,
  clipDurationKnown = true,
  suggested,
  value,
  onChange,
  disabled = false,
  preview,
}: {
  clipDurationSec: number
  /** False when the clip length is only inferred from the suggested segment. */
  clipDurationKnown?: boolean
  suggested: TrimRange | null
  value: TrimRange
  onChange: (next: TrimRange) => void
  disabled?: boolean
  /** Guide compiled by the last dry run and the segment it covers. */
  preview: { guide: GuidePuppetProps['guide']; range: TrimRange; title: string } | null
}) {
  const trackRef = useRef<HTMLDivElement>(null)
  const [dragging, setDragging] = useState<Handle | null>(null)
  const [playing, setPlaying] = useState(false)
  const [runId, setRunId] = useState(0)
  const [speed, setSpeed] = useState<0.75 | 1>(1)
  const [mirrored, setMirrored] = useState(true)
  const [playheadSec, setPlayheadSec] = useState<number | null>(null)
  const playStartRef = useRef(0)

  const duration = Math.max(clipDurationSec, value.endSec, MIN_SPAN_SEC)
  const pct = (sec: number) => `${(Math.min(Math.max(sec, 0), duration) / duration) * 100}%`
  const previewStale = preview !== null && !sameTrim(preview.range, value)
  const guideDuration = preview
    ? preview.guide.durationSec || preview.guide.frames.length / preview.guide.hz
    : 0

  // Playhead over the previewed segment, in step with the puppet's own clock.
  useEffect(() => {
    if (!playing || !preview) return
    let frame = 0
    const tick = () => {
      const elapsed = ((performance.now() - playStartRef.current) / 1000) * speed
      if (elapsed >= guideDuration) {
        setPlaying(false)
        setPlayheadSec(null)
        return
      }
      setPlayheadSec(preview.range.startSec + elapsed)
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [playing, preview, speed, guideDuration])

  function startPreview() {
    playStartRef.current = performance.now()
    setRunId((id) => id + 1)
    setPlaying(true)
  }

  function stopPreview() {
    setPlaying(false)
    setPlayheadSec(null)
  }

  function move(handle: Handle, sec: number) {
    const s = round(sec)
    if (handle === 'start') {
      const startSec = Math.min(Math.max(0, s), value.endSec - MIN_SPAN_SEC)
      if (startSec !== value.startSec) onChange({ startSec: Math.max(0, startSec), endSec: value.endSec })
    } else {
      const endSec = Math.max(Math.min(duration, s), value.startSec + MIN_SPAN_SEC)
      if (endSec !== value.endSec) onChange({ startSec: value.startSec, endSec: Math.min(duration, endSec) })
    }
  }

  function secAt(clientX: number) {
    const rect = trackRef.current?.getBoundingClientRect()
    if (!rect || rect.width === 0) return 0
    return ((clientX - rect.left) / rect.width) * duration
  }

  function onHandlePointerDown(handle: Handle, e: PointerEvent<HTMLButtonElement>) {
    if (disabled) return
    e.preventDefault()
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    e.currentTarget.focus()
    setDragging(handle)
  }

  function onHandlePointerMove(handle: Handle, e: PointerEvent<HTMLButtonElement>) {
    if (dragging !== handle) return
    move(handle, secAt(e.clientX))
  }

  function onTrackPointerDown(e: PointerEvent<HTMLDivElement>) {
    if (disabled) return
    const sec = secAt(e.clientX)
    const handle: Handle = Math.abs(sec - value.startSec) <= Math.abs(sec - value.endSec) ? 'start' : 'end'
    move(handle, sec)
  }

  function onHandleKeyDown(handle: Handle, e: KeyboardEvent<HTMLButtonElement>) {
    const current = handle === 'start' ? value.startSec : value.endSec
    const step = e.shiftKey ? KEY_STEP_LARGE_SEC : KEY_STEP_SEC
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') move(handle, current + step)
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') move(handle, current - step)
    else if (e.key === 'Home') move(handle, handle === 'start' ? 0 : value.startSec + MIN_SPAN_SEC)
    else if (e.key === 'End') move(handle, handle === 'start' ? value.endSec - MIN_SPAN_SEC : duration)
    else return
    e.preventDefault()
  }

  const step = tickStep(duration)
  const ticks: number[] = []
  for (let t = 0; t <= duration + 1e-6; t += step) ticks.push(Number(t.toFixed(3)))

  const handles: Array<{ id: Handle; sec: number; label: string }> = [
    { id: 'start', sec: value.startSec, label: 'Điểm bắt đầu đoạn mẫu' },
    { id: 'end', sec: value.endSec, label: 'Điểm kết thúc đoạn mẫu' },
  ]

  return (
    <div className="space-y-4">
      <div>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div className="text-sm font-extrabold text-duo-ink">Đoạn động tác dùng làm mẫu</div>
          <div className="text-xs font-bold tabular-nums text-duo-mute">
            {secText(value.startSec)} → {secText(value.endSec)} • dài {secText(value.endSec - value.startSec)}
          </div>
        </div>

        <div className="mt-3 select-none px-2">
          <div
            ref={trackRef}
            className={['relative h-12 touch-none rounded-xl bg-duo-mist shadow-card-inner', disabled ? 'opacity-60' : 'cursor-pointer'].join(' ')}
            onPointerDown={onTrackPointerDown}
          >
            {suggested && (
              <div
                className="absolute inset-y-1 rounded-lg border-2 border-dashed border-duo-mute/60"
                style={{ left: pct(suggested.startSec), width: `calc(${pct(suggested.endSec)} - ${pct(suggested.startSec)})` }}
                title={`Gợi ý: ${secText(suggested.startSec)} → ${secText(suggested.endSec)}`}
              />
            )}
            <div
              className="absolute inset-y-0 rounded-lg"
              style={{
                left: pct(value.startSec),
                width: `calc(${pct(value.endSec)} - ${pct(value.startSec)})`,
                background: 'rgba(22, 101, 52, 0.18)',
                boxShadow: `inset 0 0 0 2px ${ACCENT}`,
              }}
            />
            {playheadSec !== null && (
              <div className="pointer-events-none absolute inset-y-0 w-0.5 bg-duo-ink" style={{ left: pct(playheadSec) }} />
            )}
            {handles.map((h) => (
              <button
                key={h.id}
                type="button"
                role="slider"
                aria-label={h.label}
                aria-valuemin={0}
                aria-valuemax={Number(duration.toFixed(2))}
                aria-valuenow={Number(h.sec.toFixed(2))}
                aria-valuetext={secText(h.sec)}
                disabled={disabled}
                onPointerDown={(e) => onHandlePointerDown(h.id, e)}
                onPointerMove={(e) => onHandlePointerMove(h.id, e)}
                onPointerUp={() => setDragging(null)}
                onPointerCancel={() => setDragging(null)}
                onKeyDown={(e) => onHandleKeyDown(h.id, e)}
                className="absolute -top-1 bottom-[-4px] w-4 -translate-x-1/2 cursor-ew-resize rounded-md bg-duo-green shadow-chip outline-none focus-visible:ring-2 focus-visible:ring-duo-blue disabled:cursor-not-allowed"
                style={{ left: pct(h.sec) }}
              >
                <span className="mx-auto block h-5 w-0.5 rounded-full bg-white/80" />
              </button>
            ))}
          </div>
          <div className="relative mt-1 h-4">
            {ticks.map((t) => (
              <span
                key={t}
                className="absolute -translate-x-1/2 text-[11px] font-bold tabular-nums text-duo-mute"
                style={{ left: pct(t) }}
              >
                {formatNumber(t, 1)}s
              </span>
            ))}
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-end gap-3">
          {handles.map((h) => (
            <label key={h.id} className="block w-32">
              <span className="mb-1 block text-xs font-extrabold uppercase tracking-wide text-duo-mute">
                {h.id === 'start' ? 'Bắt đầu (s)' : 'Kết thúc (s)'}
              </span>
              <input
                type="number"
                className="input-duo !py-2"
                min={0}
                max={Number(duration.toFixed(2))}
                step={KEY_STEP_SEC}
                value={Number(h.sec.toFixed(2))}
                disabled={disabled}
                onChange={(e) => {
                  const sec = Number(e.target.value)
                  if (Number.isFinite(sec)) move(h.id, sec)
                }}
              />
            </label>
          ))}
          {suggested && (
            <button
              type="button"
              className="btn-duo-secondary !px-3 !py-2"
              disabled={disabled || sameTrim(suggested, value)}
              onClick={() => onChange({ ...suggested })}
            >
              <RotateCcw className="h-4 w-4" />
              Dùng đoạn gợi ý
            </button>
          )}
        </div>

        <div className="mt-2 space-y-1 text-xs font-semibold text-duo-mute">
          <div>
            Khung viền nét đứt là đoạn hệ thống gợi ý (từ lúc bắt đầu cử động đến lúc dừng). Kéo hai tay nắm hoặc dùng phím mũi
            tên (giữ Shift để nhảy 1 giây).
          </div>
          {!clipDurationKnown && (
            <div className="text-yellow-800">Không rõ độ dài video nguồn; thanh thời gian chỉ kéo dài tới cuối đoạn gợi ý.</div>
          )}
        </div>
      </div>

      {preview && (
        <div className="flex flex-col gap-4 rounded-2xl bg-duo-mist p-4 sm:flex-row sm:items-center">
          <div className="mx-auto flex-shrink-0 overflow-hidden rounded-2xl bg-white shadow-card-inner sm:mx-0">
            <GuidePuppet
              key={runId}
              guide={preview.guide}
              playing={playing}
              speed={speed}
              mirrored={mirrored}
              pose={playing ? 'demo' : 'idle'}
              title={preview.title}
              size={220}
              onEnded={stopPreview}
            />
          </div>
          <div className="min-w-0 flex-1 space-y-3">
            <div className="text-sm font-extrabold text-duo-ink">Xem trước bạn Mầm làm mẫu</div>
            <div className="text-xs font-bold tabular-nums text-duo-mute">
              Đoạn {secText(preview.range.startSec)} → {secText(preview.range.endSec)} • {secText(guideDuration)}
            </div>
            {previewStale && (
              <div className="rounded-xl bg-yellow-50 px-3 py-2 text-xs font-bold text-yellow-900">
                Bản xem trước là đoạn của lần kiểm tra trước. Bấm “Kiểm tra lại” để xem đoạn vừa chọn.
              </div>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" className="btn-duo !px-4 !py-2" onClick={playing ? stopPreview : startPreview}>
                {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                {playing ? 'Dừng' : 'Phát'}
              </button>
              <select
                className="rounded-xl bg-white px-2 py-2 text-xs font-bold text-duo-ink shadow-chip outline-none"
                value={speed}
                onChange={(e) => setSpeed(Number(e.target.value) === 0.75 ? 0.75 : 1)}
                aria-label="Tốc độ phát"
                disabled={playing}
              >
                <option value={1}>1×</option>
                <option value={0.75}>0,75×</option>
              </select>
              <label className="flex cursor-pointer items-center gap-2 text-xs font-bold text-duo-ink">
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-duo-green"
                  checked={mirrored}
                  onChange={(e) => setMirrored(e.target.checked)}
                />
                Hiển thị kiểu soi gương
              </label>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
