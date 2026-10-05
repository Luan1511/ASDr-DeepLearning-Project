import { Link } from 'react-router-dom'
import { DashboardLayout } from '../layouts/DashboardLayout'
import { AnalysisSteps } from '../components/AnalysisSteps'
import { ScreeningUploadPanel } from '../components/ScreeningUploadPanel'

export function ScreeningPage() {
  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-black text-duo-ink">Sàng lọc ASD</h1>
          <p className="mt-1 text-sm font-semibold text-duo-mute">
            Chọn hồ sơ trẻ, xác nhận đồng ý, tải video trẻ đi thẳng và nhận kết quả tham khảo.
          </p>
        </div>

        <ScreeningUploadPanel
          title="Tải video"
          headerRight={
            <Link to="/guide" className="link-duo text-xs">
              Hướng dẫn quay
            </Link>
          }
        />

        <AnalysisSteps />
      </div>
    </DashboardLayout>
  )
}
