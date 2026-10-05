import { useNavigate } from 'react-router-dom'
import { DashboardLayout } from '../layouts/DashboardLayout'
import { AnalysisSteps } from '../components/AnalysisSteps'
import { AIAssistantCard } from '../components/AIAssistantCard'
import { RecentResultsCard } from '../components/RecentResultsCard'
import { ScreeningUploadPanel } from '../components/ScreeningUploadPanel'
import { useAuth } from '../state/auth'

export function HomePage() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const firstName = user?.name.split(' ').at(-1) ?? 'bạn'

  return (
    <DashboardLayout>
      <div className="grid grid-cols-1 gap-8 xl:grid-cols-[1fr_360px]">
        <div className="space-y-8">
          <div>
            <h1 className="text-4xl font-black text-duo-ink">Xin chào, {firstName}!</h1>
            <p className="mt-2 text-base font-semibold text-duo-mute">
              Tải video ngắn trẻ đi thẳng để AI phân tích chuyển động — kết quả chỉ mang tính tham khảo.
            </p>
          </div>

          <ScreeningUploadPanel
            title="Bắt đầu sàng lọc"
            headerRight={
              <button type="button" className="link-duo text-xs" onClick={() => navigate('/guide')}>
                Hướng dẫn quay
              </button>
            }
          />

          <AnalysisSteps />
        </div>

        <div className="space-y-4">
          <RecentResultsCard />
          <AIAssistantCard />
        </div>
      </div>
    </DashboardLayout>
  )
}
