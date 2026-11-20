import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { DashboardLayout } from '../layouts/DashboardLayout'
import { api } from '../lib/api'
import { AnalysisSteps } from '../components/AnalysisSteps'
import { ScreeningUploadPanel } from '../components/ScreeningUploadPanel'
import { KinectScreening } from './KinectPage'

/**
 * Screening runs on the Kinect station. Video upload (OpenPose) is paused for parents
 * (VIDEO_SCREENING on the backend) and only shown when the server still allows it.
 */
export function ScreeningPage() {
  const [params] = useSearchParams()
  const [videoScreening, setVideoScreening] = useState(false)

  useEffect(() => {
    api.get('/screenings/capabilities').then(
      (r) => setVideoScreening(Boolean(r.data.videoScreening)),
      () => setVideoScreening(false),
    )
  }, [])

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-black text-duo-ink">Sàng lọc dáng đi</h1>
          <p className="mt-1 text-sm font-semibold text-duo-mute">
            Kết nối trạm Kinect, ghi trẻ đi vài bước và nhận kết quả tham khảo. Kết quả không thay thế chẩn đoán của bác sĩ.
          </p>
        </div>

        <KinectScreening />

        {videoScreening && (
          <details className="space-y-4">
            <summary className="cursor-pointer text-sm font-extrabold text-duo-mute">Tải video (OpenPose · đang tạm ngưng với phụ huynh)</summary>
            <div className="mt-4 space-y-6">
              <ScreeningUploadPanel
                title="Tải video"
                initialChildId={params.get('childId') ?? undefined}
                headerRight={
                  <Link to="/guide" className="link-duo text-xs">
                    Hướng dẫn quay
                  </Link>
                }
              />
              <AnalysisSteps />
            </div>
          </details>
        )}
      </div>
    </DashboardLayout>
  )
}
