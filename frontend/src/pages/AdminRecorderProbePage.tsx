import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, Camera, CircleCheck, CircleX, Download, Loader2, Video } from 'lucide-react'
import { DashboardLayout } from '../layouts/DashboardLayout'
import { Card } from '../components/Card'
import { WebcamRecorder } from '../components/exercise/WebcamRecorder'
import { formatBytes, formatNumber } from '../lib/format'
import {
  CAMERA_CONSTRAINTS,
  RECORDER_BITS_PER_SECOND,
  RECORDER_MIME_CANDIDATES,
  isRecorderMimeSupported,
  pickRecorderMime,
  recorderFormatFor,
  useCameraRecorder,
} from '../lib/recording'
import { useExerciseCapabilities } from '../lib/useExerciseCapabilities'
import { readVideoMetadata } from '../lib/video'

const PROBE_MS = 5000
const ATTESTATION =
  'Người trong video mẫu là thành viên nhóm (người lớn) đã đồng ý cho dùng khung xương làm động tác mẫu; không phải trẻ em.'

type ProbeResult = {
  url: string
  filename: string
  mimeType: string
  size: number
  durationMs: number
  width: number | null
  height: number | null
  /** Duration read back from the file by the browser (WebM often has none). */
  containerMs: number | null
}

/**
 * Gate G0 helper: records 5 s with exactly the practice recorder settings and
 * saves the file on this computer only (nothing is uploaded), so the owner can
 * run `npm run exercises:probe-ml` against the deployed ML server.
 */
export function AdminRecorderProbePage() {
  const caps = useExerciseCapabilities()
  const support = useMemo(() => RECORDER_MIME_CANDIDATES.map((mime) => ({ mime, ok: isRecorderMimeSupported(mime) })), [])
  const defaultMime = useMemo(() => pickRecorderMime(caps)?.mimeType ?? null, [caps])
  const [chosenMime, setChosenMime] = useState<string | null>(null)
  const mime = chosenMime ?? defaultMime
  const format = useMemo(() => (mime ? recorderFormatFor(mime) : null), [mime])

  const camera = useCameraRecorder({ format })
  const [attested, setAttested] = useState(false)
  const [recording, setRecording] = useState(false)
  const [result, setResult] = useState<ProbeResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!result) return
    const url = result.url
    return () => URL.revokeObjectURL(url)
  }, [result])

  const settings = camera.stream?.getVideoTracks()[0]?.getSettings() ?? null

  async function record() {
    if (!format) return
    setError(null)
    setResult(null)
    if (camera.start() === null) return
    setRecording(true)
    await new Promise((resolve) => window.setTimeout(resolve, PROBE_MS))
    const rec = await camera.stop()
    setRecording(false)
    if (!rec) {
      setError('Không ghi được video (camera bị ngắt hoặc tab bị ẩn khi đang quay). Hãy thử lại.')
      return
    }
    const filename = `probe-${new Date().toISOString().replace(/[:.]/g, '-')}${rec.format.extension}`
    const meta = await readVideoMetadata(new File([rec.blob], filename, { type: rec.format.blobType }))
    setResult({
      url: URL.createObjectURL(rec.blob),
      filename,
      mimeType: rec.format.mimeType,
      size: rec.blob.size,
      durationMs: rec.durationMs,
      width: rec.width,
      height: rec.height,
      containerMs: meta?.durationMs ?? null,
    })
  }

  const video = CAMERA_CONSTRAINTS.video as MediaTrackConstraints

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex flex-wrap items-center gap-3">
          <Link to="/admin/exercises" className="btn-duo-ghost !px-3 !py-2" aria-label="Về quản lý bài tập">
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div>
            <h1 className="text-2xl font-black text-duo-ink">Thử bộ ghi hình (Gate G0)</h1>
            <p className="mt-1 text-sm font-semibold text-duo-mute">
              Quay 5 giây với đúng cấu hình trang tập của trẻ, rồi lưu tệp về máy này để chạy kiểm tra máy phân tích.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
          <Card title="Định dạng ghi">
            <div className="space-y-4 text-sm">
              <div className="space-y-1 font-semibold text-duo-ink">
                <div>
                  Máy phân tích:{' '}
                  <span className="font-extrabold">
                    {caps === null ? 'đang kiểm tra...' : !caps.mlReachable ? 'không kết nối được' : caps.mlLegacy ? 'bản 1.0 (cũ)' : 'bản 2.0'}
                  </span>
                </div>
                <div>
                  Nhận WebM: <span className="font-extrabold">{caps?.acceptsWebm ? 'có' : 'không'}</span>
                  {caps && ` • Đuôi tệp: ${caps.acceptedExtensions.join(', ')}`}
                </div>
                <div className="text-xs font-bold text-duo-mute">
                  Camera: {String((video.width as ConstrainULongRange)?.ideal)}×{String((video.height as ConstrainULongRange)?.ideal)},{' '}
                  {String((video.frameRate as ConstrainDoubleRange)?.ideal)} fps (tối đa {String((video.frameRate as ConstrainDoubleRange)?.max)}),
                  không ghi âm, {formatNumber(RECORDER_BITS_PER_SECOND / 1_000_000, 1)} Mbps.
                </div>
              </div>

              <div role="radiogroup" aria-label="Định dạng MediaRecorder" className="space-y-1.5">
                {support.map(({ mime: m, ok }) => (
                  <label
                    key={m}
                    className={[
                      'flex items-center gap-2 rounded-xl px-3 py-2 font-bold',
                      ok ? 'cursor-pointer hover:bg-duo-mist' : 'opacity-50',
                      mime === m ? 'bg-duo-green-soft' : '',
                    ].join(' ')}
                  >
                    <input
                      type="radio"
                      name="probe-mime"
                      className="accent-duo-green"
                      disabled={!ok || recording}
                      checked={mime === m}
                      onChange={() => setChosenMime(m)}
                    />
                    {ok ? <CircleCheck className="h-4 w-4 text-duo-green" /> : <CircleX className="h-4 w-4 text-duo-mute" />}
                    <code className="text-xs">{m}</code>
                    {defaultMime === m && <span className="text-xs font-extrabold text-duo-green-dark">(trang tập dùng)</span>}
                  </label>
                ))}
              </div>
              {!defaultMime && (
                <div className="rounded-2xl bg-yellow-50 px-4 py-3 font-bold text-yellow-900">
                  Trình duyệt này không có định dạng nào trang tập sẽ dùng; phụ huynh sẽ được mời tải video lên.
                </div>
              )}
            </div>
          </Card>

          <Card title="Quay thử 5 giây">
            <div className="space-y-4">
              <WebcamRecorder stream={camera.stream} status={camera.status} />
              {settings && (
                <div className="text-xs font-bold text-duo-mute">
                  Camera thực tế: {settings.width ?? '?'}×{settings.height ?? '?'} • {settings.frameRate ? formatNumber(settings.frameRate, 1) : '?'} fps
                </div>
              )}
              {camera.error && <div className="rounded-2xl bg-red-50 px-4 py-3 text-sm font-bold text-duo-red">{camera.error}</div>}
              {error && <div className="rounded-2xl bg-red-50 px-4 py-3 text-sm font-bold text-duo-red">{error}</div>}

              <label className="flex cursor-pointer items-start gap-2 text-sm font-bold text-duo-ink">
                <input
                  type="checkbox"
                  className="mt-0.5 h-4 w-4 accent-duo-green"
                  checked={attested}
                  onChange={(e) => setAttested(e.target.checked)}
                />
                <span>{ATTESTATION}</span>
              </label>

              <div className="flex flex-wrap gap-3">
                {camera.status !== 'ready' && camera.status !== 'recording' && (
                  <button type="button" className="btn-duo-blue" disabled={camera.status === 'opening'} onClick={() => void camera.open()}>
                    <Camera className="h-4 w-4" />
                    Bật camera
                  </button>
                )}
                <button
                  type="button"
                  className="btn-duo"
                  disabled={!attested || !format || camera.status !== 'ready' || recording}
                  onClick={() => void record()}
                >
                  {recording ? <Loader2 className="h-4 w-4 animate-spin" /> : <Video className="h-4 w-4" />}
                  {recording ? 'Đang quay 5 giây...' : 'Quay 5 giây'}
                </button>
              </div>
            </div>
          </Card>
        </div>

        {result && (
          <Card title="Kết quả">
            <div className="space-y-4">
              <dl className="grid grid-cols-1 gap-x-6 gap-y-1.5 text-sm sm:grid-cols-2">
                <div className="flex justify-between gap-3">
                  <dt className="font-bold text-duo-mute">Định dạng</dt>
                  <dd className="font-extrabold text-duo-ink">
                    <code className="text-xs">{result.mimeType}</code>
                  </dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="font-bold text-duo-mute">Dung lượng</dt>
                  <dd className="font-extrabold text-duo-ink">{formatBytes(result.size)}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="font-bold text-duo-mute">Thời lượng đo (performance.now)</dt>
                  <dd className="font-extrabold tabular-nums text-duo-ink">{Math.round(result.durationMs)} ms</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="font-bold text-duo-mute">Thời lượng trong tệp</dt>
                  <dd className="font-extrabold tabular-nums text-duo-ink">
                    {result.containerMs !== null ? `${result.containerMs} ms` : 'không đọc được'}
                  </dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="font-bold text-duo-mute">Kích thước khung</dt>
                  <dd className="font-extrabold text-duo-ink">
                    {result.width ?? '?'}×{result.height ?? '?'}
                  </dd>
                </div>
              </dl>
              <video src={result.url} controls playsInline className="max-h-80 w-full rounded-2xl bg-duo-ink" />
              <a href={result.url} download={result.filename} className="btn-duo">
                <Download className="h-4 w-4" />
                Lưu tệp về máy
              </a>
              <div className="rounded-2xl bg-duo-mist px-4 py-3 text-sm font-semibold leading-relaxed text-duo-ink">
                <div>
                  Sau khi lưu, chạy trong thư mục <code>backend</code>:
                </div>
                <code className="mt-1 block break-all text-xs">npm run exercises:probe-ml -- &lt;đường dẫn tệp {result.filename}&gt;</code>
                <div className="mt-1 text-xs font-bold text-duo-mute">
                  Với tệp WebM trên máy phân tích bản 1.0, thêm <code>--as-mkv</code>. Tệp chỉ nằm trên máy này; xoá sau khi kiểm tra xong.
                </div>
              </div>
            </div>
          </Card>
        )}
      </div>
    </DashboardLayout>
  )
}
