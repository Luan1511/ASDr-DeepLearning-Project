import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Download, Film, Pause, Play, RefreshCw, Trash2 } from 'lucide-react'
import { DashboardLayout } from '../layouts/DashboardLayout'
import { Card } from '../components/Card'
import { UploadDropzone } from '../components/UploadDropzone'
import { api, apiErrorMessage } from '../lib/api'
import { computeViewport, drawSkeletonFrame, type SkeletonFrame } from '../lib/skeleton'

type VideoInfo = {
  fps?: number | null
  width?: number | null
  height?: number | null
  frame_count?: number | null
  duration_sec?: number | null
}

type SubjectMetadata = {
  subject_id: string
  filename: string
  created_at: string
  num_frames: number
  status: string
  has_prediction: boolean
  video?: VideoInfo | null
  video_retention?: string
}

const CANVAS_WIDTH = 960
const CANVAS_HEIGHT = 540
// Fallback when the ML server predates video probing (typical phone video).
const DEFAULT_FPS = 30
const SPEEDS = [0.25, 0.5, 1] as const
const SKELETON_ACCEPT = 'video/mp4,video/quicktime,video/x-msvideo,video/x-matroska,video/webm,.mp4,.mov,.avi,.mkv,.webm'

const RETENTION_LABEL: Record<string, string> = {
  blurred: 'Video đã làm mờ mặt',
  none: 'Không lưu video',
  raw: 'Lưu video gốc',
}

function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  // Revoke later: some browsers cancel the download if revoked synchronously.
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

export function AdminSkeletonPage() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [subjects, setSubjects] = useState<SubjectMetadata[] | null>(null)
  const [subjectId, setSubjectId] = useState<string | null>(null)
  const [metadata, setMetadata] = useState<SubjectMetadata | null>(null)
  const [frames, setFrames] = useState<SkeletonFrame[]>([])
  const [video, setVideo] = useState<VideoInfo | null>(null)
  const [currentIndex, setCurrentIndex] = useState(0)
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>(1)
  const [isPlaying, setIsPlaying] = useState(false)
  const [isProcessing, setIsProcessing] = useState(false)
  const [loadingSubject, setLoadingSubject] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [downloadLoading, setDownloadLoading] = useState(false)
  const [exportingVideo, setExportingVideo] = useState(false)

  const fps = video?.fps && video.fps > 0 ? video.fps : DEFAULT_FPS
  const viewport = useMemo(() => computeViewport(frames, CANVAS_WIDTH, CANVAS_HEIGHT, video), [frames, video])

  const applySubjects = useCallback(
    (list: SubjectMetadata[]) =>
      setSubjects([...list].sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? ''))),
    [],
  )

  const showSubjectsError = useCallback(async (err: unknown) => {
    setSubjects([])
    setError(await apiErrorMessage(err, 'Không tải được danh sách subject từ máy chủ phân tích.'))
  }, [])

  const loadSubjects = useCallback(
    () =>
      api
        .get('/admin/skeleton/subjects/list')
        .then((res) => applySubjects(res.data.subjects ?? []), showSubjectsError),
    [applySubjects, showSubjectsError],
  )

  useEffect(() => {
    api
      .get('/admin/skeleton/subjects/list')
      .then((res) => applySubjects(res.data.subjects ?? []), showSubjectsError)
  }, [applySubjects, showSubjectsError])

  useEffect(() => {
    const ctx = canvasRef.current?.getContext('2d')
    if (!ctx || exportingVideo) return
    drawSkeletonFrame(ctx, frames[currentIndex] ?? null, viewport, CANVAS_WIDTH, CANVAS_HEIGHT)
  }, [frames, currentIndex, viewport, exportingVideo])

  useEffect(() => {
    if (!isPlaying || frames.length === 0) return
    const timer = window.setInterval(() => {
      setCurrentIndex((prev) => (prev + 1) % frames.length)
    }, 1000 / (fps * speed))
    return () => window.clearInterval(timer)
  }, [frames.length, isPlaying, fps, speed])

  async function openSubject(id: string) {
    setError(null)
    setIsPlaying(false)
    setLoadingSubject(true)
    setSubjectId(id)
    setFrames([])
    setCurrentIndex(0)
    try {
      const [detailRes, keypointsRes] = await Promise.all([
        api.get(`/admin/skeleton/${id}`),
        api.get(`/admin/skeleton/${id}/keypoints`),
      ])
      const meta: SubjectMetadata = detailRes.data.metadata
      setMetadata(meta)
      setVideo(keypointsRes.data.video ?? meta?.video ?? null)
      setFrames(keypointsRes.data.frames ?? [])
    } catch (err) {
      setError(await apiErrorMessage(err, 'Không tải được skeleton của subject này.'))
    } finally {
      setLoadingSubject(false)
    }
  }

  async function handleFileSelected(file: File) {
    setError(null)
    setIsProcessing(true)
    setIsPlaying(false)
    try {
      const formData = new FormData()
      formData.append('video', file)
      const res = await api.post('/admin/skeleton/extract', formData)
      await openSubject(res.data.subject_id as string)
      void loadSubjects()
    } catch (err) {
      setError(await apiErrorMessage(err, 'Không thể trích xuất skeleton.'))
    } finally {
      setIsProcessing(false)
    }
  }

  async function handleDelete() {
    if (!subjectId) return
    if (!window.confirm(`Xoá vĩnh viễn subject ${subjectId} trên máy chủ phân tích (keypoints, video, dự đoán)?`)) return
    setError(null)
    try {
      await api.delete(`/admin/skeleton/${subjectId}`)
      setSubjectId(null)
      setMetadata(null)
      setFrames([])
      setVideo(null)
      void loadSubjects()
    } catch (err) {
      setError(await apiErrorMessage(err, 'Không xoá được subject.'))
    }
  }

  async function handleDownload() {
    if (!subjectId) return
    setDownloadLoading(true)
    setError(null)
    try {
      const res = await api.get(`/admin/skeleton/${subjectId}/download`, { responseType: 'blob' })
      saveBlob(new Blob([res.data], { type: 'application/zip' }), `${subjectId}.zip`)
    } catch (err) {
      setError(await apiErrorMessage(err, 'Không thể tải ZIP skeleton.'))
    } finally {
      setDownloadLoading(false)
    }
  }

  /**
   * Records the canvas in real time. Each frame is drawn when its timestamp
   * (index / fps) is reached, so the WebM plays once at the original speed
   * regardless of the screen refresh rate.
   */
  async function handleGenerateVisualizationVideo() {
    const canvas = canvasRef.current
    if (!frames.length || !canvas) return
    const ctx = canvas.getContext('2d')
    const stream: MediaStream | undefined = canvas.captureStream
      ? canvas.captureStream(Math.min(60, Math.ceil(fps)))
      : (canvas as HTMLCanvasElement & { mozCaptureStream?: (fps: number) => MediaStream }).mozCaptureStream?.(
          Math.min(60, Math.ceil(fps)),
        )
    if (!stream || !ctx || typeof MediaRecorder === 'undefined') {
      setError('Trình duyệt không hỗ trợ ghi canvas thành video.')
      return
    }

    setIsPlaying(false)
    setExportingVideo(true)
    setError(null)
    try {
      const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9') ? 'video/webm;codecs=vp9' : 'video/webm'
      const recorder = new MediaRecorder(stream, { mimeType })
      const chunks: BlobPart[] = []

      await new Promise<void>((resolve, reject) => {
        recorder.ondataavailable = (event) => {
          if (event.data.size > 0) chunks.push(event.data)
        }
        recorder.onerror = () => reject(new Error('Không thể ghi video visualize.'))
        recorder.onstop = () => resolve()

        drawSkeletonFrame(ctx, frames[0], viewport, CANVAS_WIDTH, CANVAS_HEIGHT)
        recorder.start()
        const start = performance.now()
        let drawn = 0

        const tick = () => {
          const due = Math.floor(((performance.now() - start) / 1000) * fps)
          if (due >= frames.length) {
            // Hold the last frame briefly so the encoder flushes it.
            window.setTimeout(() => {
              recorder.stop()
              stream.getTracks().forEach((track) => track.stop())
            }, 1000 / fps)
            return
          }
          if (due !== drawn) {
            drawn = due
            drawSkeletonFrame(ctx, frames[due], viewport, CANVAS_WIDTH, CANVAS_HEIGHT)
            setCurrentIndex(due)
          }
          requestAnimationFrame(tick)
        }
        requestAnimationFrame(tick)
      })

      saveBlob(new Blob(chunks, { type: 'video/webm' }), `${subjectId ?? 'skeleton-visualize'}.webm`)
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : 'Không thể tạo video visualize.')
    } finally {
      setExportingVideo(false)
    }
  }

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <Card title="Admin – Trích xuất skeleton (OpenPose BODY_25)">
          <div className="space-y-4">
            <UploadDropzone
              disabled={isProcessing}
              accept={SKELETON_ACCEPT}
              helperText={isProcessing ? 'Đang trích xuất skeleton bằng OpenPose...' : 'Hỗ trợ .mp4, .mov, .avi, .mkv, .webm'}
              onFileSelected={handleFileSelected}
            />
            {error && <div className="rounded-2xl bg-red-50 px-4 py-3 text-sm font-bold text-duo-red">{error}</div>}
          </div>
        </Card>

        <div className="grid grid-cols-1 gap-6 xl:grid-cols-[320px_1fr]">
          <Card
            title="Subjects trên máy chủ"
            right={
              <button type="button" className="link-duo text-xs" onClick={() => void loadSubjects()}>
                Tải lại
              </button>
            }
          >
            {subjects === null && <div className="text-sm font-semibold text-duo-mute">Đang tải...</div>}
            {subjects?.length === 0 && <div className="text-sm font-semibold text-duo-mute">Chưa có subject.</div>}
            <div className="max-h-[480px] space-y-1.5 overflow-auto">
              {(subjects ?? []).map((s) => (
                <button
                  key={s.subject_id}
                  type="button"
                  onClick={() => void openSubject(s.subject_id)}
                  className={[
                    'w-full rounded-2xl px-3 py-2.5 text-left transition-all',
                    s.subject_id === subjectId ? 'bg-duo-green-soft shadow-ring-green' : 'hover:bg-duo-mist',
                  ].join(' ')}
                >
                  <div className="truncate text-sm font-extrabold text-duo-ink">{s.filename || s.subject_id}</div>
                  <div className="truncate text-xs font-bold text-duo-mute">
                    {s.num_frames} frame • {s.has_prediction ? 'có dự đoán' : 'chỉ skeleton'} •{' '}
                    {s.created_at ? new Date(s.created_at).toLocaleString('vi-VN') : '—'}
                  </div>
                </button>
              ))}
            </div>
          </Card>

          <div className="space-y-6">
            {loadingSubject && <Card title="Visualization">Đang tải skeleton...</Card>}

            {!loadingSubject && subjectId && metadata && (
              <Card
                title="Visualization"
                right={
                  <button type="button" className="btn-duo-secondary !px-3 !py-2" onClick={handleDelete}>
                    <Trash2 className="h-4 w-4" />
                    <span>Xoá</span>
                  </button>
                }
              >
                <div className="space-y-4">
                  <div className="grid gap-3 rounded-2xl bg-duo-mist p-4 text-sm md:grid-cols-4">
                    <div className="min-w-0">
                      <div className="text-xs font-extrabold uppercase tracking-wide text-duo-mute">Subject</div>
                      <div className="mt-1 truncate font-black text-duo-ink" title={subjectId}>
                        {subjectId}
                      </div>
                    </div>
                    <div>
                      <div className="text-xs font-extrabold uppercase tracking-wide text-duo-mute">Frame</div>
                      <div className="mt-1 font-black text-duo-ink">{frames.length}</div>
                    </div>
                    <div>
                      <div className="text-xs font-extrabold uppercase tracking-wide text-duo-mute">Video</div>
                      <div className="mt-1 font-black text-duo-ink">
                        {video?.width && video?.height ? `${video.width}×${video.height}` : 'Không rõ kích thước'}
                        {' • '}
                        {video?.fps ? `${Math.round(video.fps * 10) / 10} fps` : `~${DEFAULT_FPS} fps (giả định)`}
                      </div>
                    </div>
                    <div>
                      <div className="text-xs font-extrabold uppercase tracking-wide text-duo-mute">Lưu trữ</div>
                      <div className="mt-1 font-black text-duo-ink">
                        {metadata.video_retention ? RETENTION_LABEL[metadata.video_retention] ?? metadata.video_retention : 'Không rõ (server cũ)'}
                      </div>
                    </div>
                  </div>

                  {frames.length > 0 ? (
                    <>
                      <div className="rounded-2xl bg-[#07111d] p-3 shadow-card-inner">
                        <canvas
                          ref={canvasRef}
                          width={CANVAS_WIDTH}
                          height={CANVAS_HEIGHT}
                          className="h-auto w-full rounded-xl border border-slate-700 bg-slate-950"
                        />
                      </div>
                      {viewport.source === 'bounds' && (
                        <div className="text-xs font-bold text-duo-mute">
                          Máy chủ chưa báo kích thước video gốc nên khung hình được căn theo phạm vi skeleton (tỉ lệ vẫn giữ đúng).
                        </div>
                      )}

                      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            className="btn-duo gap-2"
                            disabled={exportingVideo}
                            onClick={() => setIsPlaying((prev) => !prev)}
                          >
                            {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                            <span>{isPlaying ? 'Dừng' : 'Phát'}</span>
                          </button>
                          <button
                            type="button"
                            className="btn-duo-secondary gap-2"
                            disabled={exportingVideo}
                            onClick={() => {
                              setCurrentIndex(0)
                              setIsPlaying(false)
                            }}
                          >
                            <RefreshCw className="h-4 w-4" />
                            <span>Về đầu</span>
                          </button>
                          <select
                            className="rounded-xl bg-white px-2 py-2 text-xs font-bold text-duo-ink shadow-chip outline-none"
                            value={speed}
                            onChange={(e) => setSpeed(Number(e.target.value) as (typeof SPEEDS)[number])}
                            aria-label="Tốc độ phát"
                          >
                            {SPEEDS.map((s) => (
                              <option key={s} value={s}>
                                {s}×
                              </option>
                            ))}
                          </select>
                          <button
                            type="button"
                            className="btn-duo-secondary gap-2"
                            onClick={handleGenerateVisualizationVideo}
                            disabled={exportingVideo}
                          >
                            <Film className="h-4 w-4" />
                            <span>{exportingVideo ? 'Đang ghi video...' : 'Xuất video WebM'}</span>
                          </button>
                        </div>
                        <div className="text-sm font-bold tabular-nums text-duo-mute">
                          Frame {Math.min(currentIndex + 1, frames.length)} / {frames.length}
                        </div>
                      </div>

                      <input
                        type="range"
                        min={0}
                        max={Math.max(frames.length - 1, 0)}
                        value={currentIndex}
                        disabled={exportingVideo}
                        onChange={(e) => {
                          setCurrentIndex(Number(e.target.value))
                          setIsPlaying(false)
                        }}
                        className="w-full accent-duo-green"
                      />
                    </>
                  ) : (
                    <div className="text-sm font-semibold text-duo-mute">Subject này không có frame keypoint.</div>
                  )}

                  <div className="flex flex-col gap-3 rounded-2xl bg-duo-mist p-4 md:flex-row md:items-center md:justify-between">
                    <div className="text-sm font-semibold text-duo-mute">
                      ZIP gồm keypoints đầy đủ, metadata, CSV phẳng và một file JSON cho mỗi frame.
                    </div>
                    <button type="button" className="btn-duo gap-2" disabled={downloadLoading} onClick={handleDownload}>
                      <Download className="h-4 w-4" />
                      <span>{downloadLoading ? 'Đang tải...' : 'Tải ZIP'}</span>
                    </button>
                  </div>
                </div>
              </Card>
            )}

            {!loadingSubject && !subjectId && (
              <Card title="Visualization">
                <div className="text-sm font-semibold text-duo-mute">Tải video lên hoặc chọn một subject để xem skeleton.</div>
              </Card>
            )}
          </div>
        </div>
      </div>
    </DashboardLayout>
  )
}
