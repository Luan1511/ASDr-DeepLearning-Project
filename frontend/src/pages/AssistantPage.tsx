import { DashboardLayout } from '../layouts/DashboardLayout'
import { AIAssistantCard } from '../components/AIAssistantCard'
import { DisclaimerCard } from '../components/DisclaimerCard'

export function AssistantPage() {
  return (
    <DashboardLayout>
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1fr_420px]">
        <AIAssistantCard />
        <DisclaimerCard />
      </div>
    </DashboardLayout>
  )
}
