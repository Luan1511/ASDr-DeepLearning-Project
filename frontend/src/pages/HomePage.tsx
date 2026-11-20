import { useEffect, useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { Footprints } from 'lucide-react'
import { DashboardLayout } from '../layouts/DashboardLayout'
import { AnalysisSteps } from '../components/AnalysisSteps'
import { AIAssistantCard } from '../components/AIAssistantCard'
import { RecentResultsCard } from '../components/RecentResultsCard'
import { ScreeningUploadPanel } from '../components/ScreeningUploadPanel'
import { KinectHistory } from '../components/KinectHistory'
import { api } from '../lib/api'
import { useAuth } from '../state/useAuth'

export function HomePage() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const firstName = user?.name.split(' ').at(-1) ?? 'bạn'
  // Video (OpenPose) screening is paused for parents; screening runs on the Kinect station.
  const [videoScreening, setVideoScreening] = useState(false)
  useEffect(() => {
    if (user?.doctor) return
    api.get('/screenings/capabilities').then(
      (r) => setVideoScreening(Boolean(r.data.videoScreening)),
      () => setVideoScreening(false),
    )
  }, [user?.doctor])

  // A doctor account starts on the doctor side (the records shared with them).
  if (user?.doctor) return <Navigate to="/doctor" replace />

  return (
    <DashboardLayout>
      <div className="grid grid-cols-1 gap-8 xl:grid-cols-[1fr_360px]">
        <div className="space-y-8">
          <div>
            <h1 className="text-4xl font-black text-duo-ink">Xin chào, {firstName}!</h1>
            <p className="mt-2 text-base font-semibold text-duo-mute">
              Ghi trẻ đi vài bước trước trạm Kinect để AI phân tích dáng đi — kết quả chỉ mang tính tham khảo.
            </p>
          </div>

          <Link to="/screening" className="card-duo flex items-center gap-4 border-2 border-duo-green p-5 hover:bg-duo-green-soft">
            <Footprints className="h-10 w-10 flex-shrink-0 text-duo-green" />
            <div>
              <h2 className="text-lg font-black text-duo-ink">Bắt đầu sàng lọc dáng đi →</h2>
              <p className="mt-1 text-sm font-semibold text-duo-mute">Kết nối trạm Kinect, xác nhận đồng ý, ghi một lượt đi và xem kết quả.</p>
            </div>
          </Link>

          <KinectHistory />

          {videoScreening && (
            <>
              <ScreeningUploadPanel
                title="Tải video (OpenPose · chỉ quản trị viên)"
                headerRight={
                  <button type="button" className="link-duo text-xs" onClick={() => navigate('/guide')}>
                    Hướng dẫn quay
                  </button>
                }
              />
              <AnalysisSteps />
            </>
          )}
        </div>

        <div className="space-y-4">
          <RecentResultsCard />
          <AIAssistantCard />
        </div>
      </div>
    </DashboardLayout>
  )
}
