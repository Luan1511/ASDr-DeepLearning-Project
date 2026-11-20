import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { CheckCircle2, Circle, Loader2, Square, Video } from 'lucide-react'
import { DashboardLayout } from '../layouts/DashboardLayout'
import { api, apiErrorCode } from '../lib/api'
import { useAuth } from '../state/useAuth'
import type { ChildProfile } from '../lib/types'
import {
  KINECT_ANALYZING_STATUSES,
  KINECT_PARENT_STATUS,
  KINECT_RECORDING_STATUSES,
  KINECT_STATUS,
  kinectDeviceProblem,
  kinectErrorText,
  kinectTrackingQuality,
  type KinectCapture,
  type KinectDevice,
  type KinectPreview,
  type KinectSession,
} from '../lib/kinect'
import { KinectSkeleton } from '../components/KinectSkeleton'
import { KinectResultView } from '../components/KinectResultView'
import { KinectHistory } from '../components/KinectHistory'

function StepCard({ n, title, done, children }: { n: number; title: string; done?: boolean; children: ReactNode }) {
  return (
    <section className="card-duo space-y-3 p-5">
      <div className="flex items-center gap-3">
        {done ? (
          <CheckCircle2 className="h-6 w-6 flex-shrink-0 text-duo-green" />
        ) : (
          <span className="grid h-6 w-6 flex-shrink-0 place-items-center rounded-full bg-duo-mist text-xs font-black text-duo-ink">{n}</span>
        )}
        <h2 className="text-base font-black text-duo-ink">{title}</h2>
      </div>
      {children}
    </section>
  )
}

/** Live WebSocket preview of the selected station's skeleton. */
function useKinectPreview(token: string | null, deviceId: string) {
  const [latest, setLatest] = useState<{ deviceId: string; payload: KinectPreview } | null>(null)
  const [connected, setConnected] = useState(false)
  const lastAt = useRef(0)

  useEffect(() => {
    if (!token) return
    let disposed = false
    let socket: WebSocket | undefined
    let retry: ReturnType<typeof setTimeout>
    let heartbeat: ReturnType<typeof setInterval>
    const connect = () => {
      const base = new URL(String(api.defaults.baseURL ?? '/api'), window.location.origin)
      base.pathname = base.pathname.replace(/\/$/, '') + '/kinect/events'
      base.protocol = base.protocol === 'https:' ? 'wss:' : 'ws:'
      socket = new WebSocket(base.toString())
      socket.onopen = () => socket?.send(JSON.stringify({ token }))
      socket.onmessage = (event) => {
        try {
          const m = JSON.parse(event.data)
          if (m.type === 'authenticated') setConnected(true)
          if (m.type === 'preview') {
            lastAt.current = Date.now()
            setLatest({ deviceId: m.deviceId, payload: m.payload })
          }
        } catch {
          /* Ignore malformed transport messages. */
        }
      }
      socket.onclose = () => {
        clearInterval(heartbeat)
        setConnected(false)
        setLatest(null)
        if (!disposed) retry = setTimeout(connect, 3000)
      }
      socket.onerror = () => socket?.close()
      heartbeat = setInterval(() => {
        if (socket?.readyState === WebSocket.OPEN) socket.send('ping')
      }, 30_000)
    }
    connect()
    return () => {
      disposed = true
      clearTimeout(retry)
      clearInterval(heartbeat)
      socket?.close()
    }
  }, [token])

  useEffect(() => {
    const t = setInterval(() => {
      if (Date.now() - lastAt.current > 2000) setLatest(null)
    }, 500)
    return () => clearInterval(t)
  }, [])
  return { preview: latest && latest.deviceId === deviceId ? latest.payload : null, connected }
}

/** Admin-only: frame viewer, manual trim and re-analysis of another segment. */
function KinectTechnicalTools({ session, onOpen, busy, run }: { session: KinectSession; onOpen: (id: string) => void; busy: boolean; run: (work: () => Promise<void>) => Promise<void> }) {
  const [open, setOpen] = useState(false)
  const [loaded, setLoaded] = useState<{ sessionId: string; capture: KinectCapture } | null>(null)
  const capture = open && loaded?.sessionId === session.id ? loaded.capture : null
  const [frame, setFrame] = useState(0)
  const [start, setStart] = useState(0)
  const [end, setEnd] = useState(2)
  const editable = ['REVIEW', 'FAILED'].includes(session.status)

  useEffect(() => {
    if (!open || !session.hasCapture) return
    let active = true
    api.get('/kinect/sessions/' + session.id + '/capture').then(
      (r) => {
        if (!active) return
        const c = r.data.capture as KinectCapture
        setLoaded({ sessionId: session.id, capture: c })
        setFrame(session.trimStart ?? 0)
        setStart(session.trimStart ?? 0)
        setEnd(session.trimEnd ?? c.xyz.length)
      },
      () => {},
    )
    return () => {
      active = false
    }
    // Reload only when another session or the panel opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, session.id, session.hasCapture])

  return (
    <details className="card-duo p-5" onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
      <summary className="cursor-pointer text-sm font-extrabold text-duo-ink">
        Công cụ kỹ thuật (quản trị) · {KINECT_STATUS[session.status] ?? session.status}
        {session.sourceSessionId ? ' · bản phân tích lại' : ''}
      </summary>
      {!session.hasCapture && <p className="mt-3 text-sm text-duo-mute">Lượt này chưa có bản ghi.</p>}
      {session.hasCapture && !capture && <p className="mt-3 text-sm text-duo-mute">Đang tải bản ghi…</p>}
      {capture && (
        <div className="mt-4 grid gap-5 xl:grid-cols-[minmax(0,1fr)_300px]">
          <div className="space-y-3">
            <KinectSkeleton xyz={capture.xyz[frame]} names={capture.jointNames} states={capture.trackingState?.[frame]} />
            <label className="block text-sm font-bold">
              Frame {frame + 1}/{capture.xyz.length} · {((capture.timestampsMs[frame] - capture.timestampsMs[0]) / 1000).toFixed(2)} s
              <input aria-label="Frame đang xem" type="range" min={0} max={capture.xyz.length - 1} value={frame} onChange={(e) => setFrame(Number(e.target.value))} className="mt-2 w-full" />
            </label>
          </div>
          <div className="space-y-3 text-sm">
            <label className="block space-y-1 font-bold">
              Frame bắt đầu
              <input aria-label="Frame bắt đầu" className="input-duo w-full" type="number" min={1} max={end - 1} disabled={!editable} value={start + 1} onChange={(e) => setStart(Math.max(0, Math.min(end - 2, Number(e.target.value) - 1)))} />
            </label>
            <button className="btn-duo-secondary w-full" disabled={!editable || frame >= end - 1} onClick={() => setStart(frame)}>
              Lấy frame đang xem làm đầu
            </button>
            <label className="block space-y-1 font-bold">
              Frame kết thúc
              <input aria-label="Frame kết thúc" className="input-duo w-full" type="number" min={start + 2} max={capture.xyz.length} disabled={!editable} value={end} onChange={(e) => setEnd(Math.min(capture.xyz.length, Math.max(start + 2, Number(e.target.value))))} />
            </label>
            <button className="btn-duo-secondary w-full" disabled={!editable || frame <= start} onClick={() => setEnd(frame + 1)}>
              Lấy frame đang xem làm cuối
            </button>
            <p className="text-duo-mute">Giữ {end - start} frame. Bản ghi gốc không đổi.</p>
            {editable ? (
              <button className="btn-duo w-full" disabled={busy} onClick={() => void run(async () => void (await api.post('/kinect/sessions/' + session.id + '/analyze', { start, end })))}>
                Phân tích đoạn đã chọn
              </button>
            ) : (
              <button
                className="btn-duo-secondary w-full"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    const r = await api.post('/kinect/sessions/' + session.id + '/derive')
                    onOpen(r.data.session.id)
                  })
                }
              >
                Phân tích đoạn khác từ bản gốc
              </button>
            )}
          </div>
        </div>
      )}
    </details>
  )
}

/** Parent flow: station → consent → record a walk → automatic analysis → result. */
export function KinectScreening() {
  const [params, setParams] = useSearchParams()
  const { token, user } = useAuth()
  const isAdmin = user?.role === 'ADMIN'
  const sessionId = params.get('sessionId')

  const [children, setChildren] = useState<ChildProfile[] | null>(null)
  const [childId, setChildId] = useState(params.get('childId') ?? '')
  const [devices, setDevices] = useState<KinectDevice[] | null>(null)
  const [deviceId, setDeviceId] = useState('')
  const [gatewayDown, setGatewayDown] = useState(false)
  const [consentInfo, setConsentInfo] = useState<{ childId: string; consent: boolean; statement: string } | null>(null)
  const [acceptedFor, setAcceptedFor] = useState('')
  const [pair, setPair] = useState<{ code: string; expires: number } | null>(null)
  const [loadedSession, setSession] = useState<KinectSession | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [recordingSince, setRecordingSince] = useState<number | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const autoAnalyzed = useRef(new Set<string>())
  const { preview, connected } = useKinectPreview(token, deviceId)

  const session = loadedSession && loadedSession.id === sessionId ? loadedSession : null
  const info = consentInfo && consentInfo.childId === childId ? consentInfo : null
  const consent = Boolean(info?.consent)
  const statement = info?.statement ?? ''
  const accepted = Boolean(childId) && acceptedFor === childId

  const device = devices?.find((d) => d.id === deviceId)
  const deviceProblem =
    devices === null ? null : gatewayDown && !device ? 'Hệ thống kết nối trạm Kinect đang tạm gián đoạn. Vui lòng thử lại sau ít phút.' : kinectDeviceProblem(device)
  const recording = Boolean(session && KINECT_RECORDING_STATUSES.includes(session.status))
  const quality = kinectTrackingQuality(preview)

  async function run(work: () => Promise<void>) {
    setBusy(true)
    setError('')
    try {
      await work()
    } catch (e) {
      setError(kinectErrorText(apiErrorCode(e)))
    } finally {
      setBusy(false)
    }
  }

  function openSession(id: string | null) {
    setRecordingSince(null)
    setParams(id ? { sessionId: id } : childId ? { childId } : {})
  }

  // One child per account: pick it without asking.
  useEffect(() => {
    api.get('/children').then(
      (r) => {
        const list = (r.data.children ?? []) as ChildProfile[]
        setChildren(list)
        setChildId((current) => current || (list.length === 1 ? list[0].id : ''))
      },
      () => setError('Chưa tải được hồ sơ trẻ.'),
    )
  }, [])

  // Stations; keep the choice, otherwise prefer one that is ready to record.
  useEffect(() => {
    let active = true
    async function load() {
      try {
        const r = await api.get('/kinect/devices')
        if (!active) return
        const list = (r.data.devices ?? []) as KinectDevice[]
        setDevices(list)
        setGatewayDown(false)
        setDeviceId((current) => (current && list.some((d) => d.id === current) ? current : (list.find((d) => !kinectDeviceProblem(d)) ?? list[0])?.id ?? ''))
      } catch {
        if (active) {
          setDevices((current) => current ?? [])
          setGatewayDown(true)
        }
      }
    }
    void load()
    const timer = setInterval(() => void load(), 3000)
    return () => {
      active = false
      clearInterval(timer)
    }
  }, [])

  useEffect(() => {
    let active = true
    if (childId)
      api.get('/kinect/consent/' + childId).then(
        (r) => {
          if (active) setConsentInfo({ childId, consent: Boolean(r.data.consent), statement: r.data.statement?.text ?? '' })
        },
        (e) => active && setError(kinectErrorText(apiErrorCode(e))),
      )
    return () => {
      active = false
    }
  }, [childId])

  // The open session, polled until it settles.
  useEffect(() => {
    if (!sessionId) return
    let active = true
    async function load() {
      try {
        const r = await api.get('/kinect/sessions/' + sessionId)
        if (!active) return
        const s = r.data.session as KinectSession
        setSession(s)
        setChildId(s.childId)
        setDeviceId(s.deviceId)
        setRecordingSince((t) => (s.status === 'RECORDING' ? (t ?? Date.now()) : null))
      } catch (e) {
        if (active) setError(kinectErrorText(apiErrorCode(e), 'Không mở được lượt này.'))
      }
    }
    void load()
    const timer = setInterval(() => void load(), 2000)
    return () => {
      active = false
      clearInterval(timer)
    }
  }, [sessionId])

  // A finished recording is analysed whole, without asking (admins trim in the tools below).
  useEffect(() => {
    if (!session || session.status !== 'REVIEW' || session.sourceSessionId || session.trimStart !== null || !session.frameCount) return
    if (autoAnalyzed.current.has(session.id)) return
    autoAnalyzed.current.add(session.id)
    void run(async () => {
      const r = await api.post('/kinect/sessions/' + session.id + '/analyze', { start: 0, end: session.frameCount })
      setSession(r.data.session)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.id, session?.status])

  useEffect(() => {
    if (!recordingSince) return
    const t = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(t)
  }, [recordingSince])

  async function startRecording() {
    await run(async () => {
      const r = await api.post('/kinect/sessions', { childId, deviceId })
      const id = r.data.session.id as string
      openSession(id)
      await api.post('/kinect/sessions/' + id + '/commands', { action: 'start' })
    })
  }
  async function stopRecording() {
    if (!session) return
    await run(async () => void (await api.post('/kinect/sessions/' + session.id + '/commands', { action: 'stop' })))
  }
  async function cancel() {
    if (!session) return
    await run(async () => {
      await api.post('/kinect/sessions/' + session.id + '/cancel')
      openSession(null)
    })
  }
  async function retryAnalysis() {
    if (!session?.frameCount) return
    await run(async () => {
      const r = await api.post('/kinect/sessions/' + session.id + '/analyze', { start: session.trimStart ?? 0, end: session.trimEnd ?? session.frameCount })
      setSession(r.data.session)
    })
  }
  async function remove() {
    if (!session || !window.confirm('Xóa lượt sàng lọc này khỏi website? Bản lưu trên laptop của trạm vẫn được giữ.')) return
    await run(async () => {
      await api.delete('/kinect/sessions/' + session.id)
      openSession(null)
    })
  }

  const child = children?.find((c) => c.id === childId)
  const stationReady = Boolean(device && !deviceProblem)
  const canRecord = Boolean(childId && consent && stationReady && !recording && !busy)
  const seconds = recordingSince ? Math.max(0, Math.floor((now - recordingSince) / 1000)) : 0
  const showSetup = !session || session.status === 'CANCELED'

  return (
    <div className="space-y-5">
      {error && (
        <div role="alert" className="rounded-2xl bg-red-50 p-4 text-sm font-bold text-duo-red">
          {error}
        </div>
      )}

      {children && children.length === 0 && (
        <div className="card-duo p-5 text-sm font-semibold text-duo-ink">
          Bạn cần tạo hồ sơ trẻ trước khi sàng lọc.{' '}
          <Link className="link-duo" to="/children">
            Tạo hồ sơ trẻ
          </Link>
        </div>
      )}
      {children && children.length > 1 && showSetup && (
        <label className="card-duo block space-y-2 p-5 text-sm font-bold">
          Hồ sơ trẻ
          <select aria-label="Hồ sơ trẻ" className="input-duo w-full" value={childId} onChange={(e) => setChildId(e.target.value)}>
            <option value="">Chọn trẻ</option>
            {children.map((c) => (
              <option key={c.id} value={c.id}>
                {c.fullName}
              </option>
            ))}
          </select>
        </label>
      )}

      {showSetup && (
        <>
          <StepCard n={1} title="Kết nối trạm Kinect" done={stationReady}>
            {devices === null && <p className="text-sm text-duo-mute">Đang kiểm tra trạm…</p>}
            {devices && devices.length > 1 && (
              <select aria-label="Trạm Kinect" className="input-duo w-full" value={deviceId} onChange={(e) => setDeviceId(e.target.value)}>
                {devices.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name} · {kinectDeviceProblem(d) ? 'chưa sẵn sàng' : 'sẵn sàng'}
                  </option>
                ))}
              </select>
            )}
            {device && !deviceProblem && (
              <p className="text-sm font-semibold text-duo-green-dark">Trạm “{device.name}” đã kết nối và sẵn sàng ghi.</p>
            )}
            {devices && deviceProblem && <p className="text-sm font-semibold text-duo-ink">{deviceProblem}</p>}
            <details className="text-sm" open={devices !== null && devices.length === 0 && !gatewayDown}>
              <summary className="cursor-pointer font-bold text-duo-mute">Ghép trạm mới</summary>
              <ol className="mt-2 list-decimal space-y-1 pl-5 text-duo-ink">
                <li>Trên laptop nối cảm biến Kinect, mở app Kinect.</li>
                <li>Bấm nút dưới đây để lấy mã ghép.</li>
                <li>Trong app: Kết nối tài khoản → Cấu hình nâng cao → nhập mã.</li>
              </ol>
              <button
                className="btn-duo-secondary mt-3"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    const r = await api.post('/kinect/pairings', {})
                    setPair({ code: r.data.code, expires: Date.now() + r.data.expiresInSeconds * 1000 })
                  })
                }
              >
                Lấy mã ghép
              </button>
              {pair && (
                <p className="mt-3 rounded-2xl bg-duo-green-soft p-4">
                  Mã <strong className="select-all text-lg tracking-widest">{pair.code}</strong> · dùng trước {new Date(pair.expires).toLocaleTimeString('vi-VN')}
                </p>
              )}
            </details>
          </StepCard>

          {childId && (
            <StepCard n={2} title="Đồng ý của phụ huynh" done={consent}>
              {consent ? (
                <p className="text-sm font-semibold text-duo-green-dark">Bạn đã đồng ý cho {child?.fullName ?? 'trẻ'} tham gia ghi dáng đi bằng Kinect.</p>
              ) : (
                <div className="space-y-3">
                  <p className="whitespace-pre-line rounded-2xl bg-duo-mist p-4 text-sm">{statement || 'Đang tải nội dung đồng ý…'}</p>
                  <label className="flex gap-3 text-sm font-semibold">
                    <input type="checkbox" checked={accepted} onChange={(e) => setAcceptedFor(e.target.checked ? childId : '')} />
                    Tôi đã đọc và đồng ý
                  </label>
                  <button
                    disabled={!accepted || !statement || busy}
                    className="btn-duo"
                    onClick={() =>
                      void run(async () => {
                        await api.post('/kinect/consent/' + childId, { accepted: true, version: 'kinect-1' })
                        setConsentInfo({ childId, consent: true, statement })
                      })
                    }
                  >
                    Xác nhận đồng ý
                  </button>
                </div>
              )}
            </StepCard>
          )}
        </>
      )}

      {(showSetup || recording) && (
        <StepCard n={3} title="Ghi dáng đi của trẻ">
          <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_280px]">
            <div className="space-y-2">
              <KinectSkeleton xyz={preview?.xyz} names={preview?.jointNames} states={preview?.trackingState} />
              <p className="text-xs font-semibold text-duo-mute">
                {!connected
                  ? 'Đang nối kênh xem trực tiếp…'
                  : !quality.visible
                    ? 'Chưa thấy người trước cảm biến.'
                    : quality.good
                      ? `Cảm biến thấy rõ cả người (${quality.tracked}/${quality.total} khớp).`
                      : `Cảm biến mới thấy ${quality.tracked}/${quality.total} khớp — để trẻ lùi xa hơn cho thấy cả đầu và bàn chân.`}
              </p>
            </div>
            <div className="space-y-3 text-sm">
              <ol className="list-decimal space-y-1 pl-5 text-duo-ink">
                <li>Đặt cảm biến cố định, cao khoảng 0,75 m, nơi rộng và đủ sáng.</li>
                <li>Cho trẻ đứng cách cảm biến khoảng 4 m, đi chân trần hoặc giày vừa chân.</li>
                <li>Bấm “Bắt đầu ghi”, rồi để trẻ đi thẳng tự nhiên về phía cảm biến.</li>
                <li>Bấm “Dừng” khi trẻ còn cách cảm biến khoảng 1 m.</li>
              </ol>
              {recording ? (
                <>
                  <div className="flex items-center gap-2 rounded-2xl bg-red-50 px-4 py-3 font-extrabold text-duo-red">
                    <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-duo-red" />
                    {KINECT_PARENT_STATUS[session!.status]}
                    {session!.status === 'RECORDING' && ` · ${seconds} giây`}
                  </div>
                  <button className="btn-duo w-full" disabled={busy || !['STARTING', 'RECORDING'].includes(session!.status)} onClick={() => void stopRecording()}>
                    <Square className="h-4 w-4" />
                    Dừng và phân tích
                  </button>
                  <button className="link-duo text-xs" disabled={busy} onClick={() => void cancel()}>
                    Hủy lượt ghi này
                  </button>
                </>
              ) : (
                <button className="btn-duo w-full" disabled={!canRecord} onClick={() => void startRecording()}>
                  <Video className="h-4 w-4" />
                  Bắt đầu ghi
                </button>
              )}
              {!recording && !canRecord && !busy && (
                <p className="text-xs font-semibold text-duo-mute">
                  {!childId ? 'Chọn hồ sơ trẻ.' : !stationReady ? 'Cần kết nối trạm ở bước 1.' : !consent ? 'Cần xác nhận đồng ý ở bước 2.' : ''}
                </p>
              )}
            </div>
          </div>
        </StepCard>
      )}

      {session && !showSetup && !recording && (
        <StepCard n={4} title={`Kết quả · ${session.child.fullName} · ${new Date(session.createdAt).toLocaleString('vi-VN')}`} done={session.status === 'COMPLETED'}>
          {session.status === 'REVIEW' && session.sourceSessionId && (
            <p className="rounded-2xl bg-duo-mist px-4 py-3 text-sm font-semibold text-duo-ink">Bản phân tích lại: chọn đoạn trong công cụ kỹ thuật bên dưới.</p>
          )}
          {((session.status === 'REVIEW' && !session.sourceSessionId) || KINECT_ANALYZING_STATUSES.includes(session.status)) && (
            <div className="flex items-center gap-2 rounded-2xl bg-duo-green-soft px-4 py-3 text-sm font-bold text-duo-green-dark">
              <Loader2 className="h-4 w-4 animate-spin" />
              {session.status === 'QUEUED' ? 'Đã nhận bản ghi, đang chờ đến lượt phân tích…' : 'Đang phân tích dáng đi, thường mất dưới một phút…'}
              {session.errorMessage === 'ML_UNAVAILABLE' && ' (máy chủ đang bận, hệ thống sẽ tự thử lại)'}
            </div>
          )}
          {session.status === 'COMPLETED' && session.result && <KinectResultView result={session.result} technical={isAdmin} />}
          {session.status === 'FAILED' && (
            <div className="space-y-3">
              <p className="rounded-2xl bg-red-50 px-4 py-3 text-sm font-semibold text-duo-red">{kinectErrorText(session.errorMessage, 'Lượt này chưa thành công. Hãy ghi lại.')}</p>
              {session.hasCapture && ['ML_UNAVAILABLE', 'MODEL_BUNDLE_MISMATCH', 'CONSENT_REQUIRED'].includes(session.errorMessage ?? '') && (
                <button className="btn-duo-secondary" disabled={busy} onClick={() => void retryAnalysis()}>
                  Thử phân tích lại
                </button>
              )}
            </div>
          )}
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-duo-line/60 pt-3">
            <button className="btn-duo" onClick={() => openSession(null)}>
              <Circle className="h-4 w-4" />
              Ghi lượt mới
            </button>
            {!KINECT_ANALYZING_STATUSES.includes(session.status) && (
              <button className="text-xs font-extrabold text-duo-red hover:underline" disabled={busy} onClick={() => void remove()}>
                Xóa lượt này
              </button>
            )}
          </div>
        </StepCard>
      )}

      {isAdmin && session && <KinectTechnicalTools session={session} onOpen={(id) => openSession(id)} busy={busy} run={run} />}

      <KinectHistory childId={childId || undefined} />
    </div>
  )
}

export function KinectPage() {
  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-black text-duo-ink">Sàng lọc dáng đi bằng Kinect</h1>
          <p className="mt-1 text-sm font-semibold text-duo-mute">Kết nối trạm, ghi trẻ đi vài bước và nhận kết quả tham khảo.</p>
        </div>
        <KinectScreening />
      </div>
    </DashboardLayout>
  )
}
