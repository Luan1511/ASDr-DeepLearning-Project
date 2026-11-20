import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../lib/api'
import { KINECT_PARENT_STATUS, type KinectSession } from '../lib/kinect'

/** Past Kinect walks of the parent's child; each row opens the screening page on that walk. */
export function KinectHistory({ childId, title = 'Các lượt sàng lọc Kinect' }: { childId?: string; title?: string }) {
  const [rows, setRows] = useState<KinectSession[] | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    async function load() {
      try {
        const r = await api.get('/kinect/sessions', { params: { childId } })
        if (active) {
          setRows(r.data.sessions)
          setError('')
        }
      } catch {
        if (active) setError('Chưa tải được các lượt sàng lọc Kinect.')
      }
    }
    void load()
    const t = setInterval(() => void load(), 5000)
    return () => {
      active = false
      clearInterval(t)
    }
  }, [childId])

  const visible = (rows ?? []).filter((s) => s.status !== 'CANCELED')
  return (
    <section className="card-duo space-y-4 p-5">
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-lg font-black text-duo-ink">{title}</h2>
        <Link className="link-duo text-sm" to={'/screening' + (childId ? '?childId=' + childId : '')}>
          Ghi lượt mới
        </Link>
      </div>
      {error && (
        <p role="alert" className="text-sm text-duo-red">
          {error}
        </p>
      )}
      {rows && !visible.length && !error && <p className="text-sm text-duo-mute">Chưa có lượt sàng lọc Kinect nào.</p>}
      <div className="space-y-2">
        {visible.map((s) => (
          <Link
            key={s.id}
            to={'/screening?sessionId=' + s.id}
            className="flex items-center justify-between gap-4 rounded-2xl bg-duo-mist px-4 py-3 hover:bg-duo-green-soft"
          >
            <div>
              <p className="text-sm font-extrabold text-duo-ink">{s.child.fullName}</p>
              <p className="text-xs font-semibold text-duo-mute">
                {new Date(s.createdAt).toLocaleString('vi-VN')} · {KINECT_PARENT_STATUS[s.status] ?? s.status}
              </p>
            </div>
            <span className="text-right text-xs font-extrabold">
              {s.result ? (
                s.result.prediction === 'ASD' ? (
                  <span className="text-amber-600">Nên theo dõi thêm</span>
                ) : (
                  <span className="text-duo-green-dark">Chưa thấy khác biệt</span>
                )
              ) : (
                <span className="text-duo-mute">Xem →</span>
              )}
            </span>
          </Link>
        ))}
      </div>
    </section>
  )
}
