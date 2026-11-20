import { DashboardLayout } from '../layouts/DashboardLayout'
import { AIAssistantCard } from '../components/AIAssistantCard'

export function AssistantPage() {
  return (
    <DashboardLayout fullHeight>
      <AIAssistantCard variant="page" />
    </DashboardLayout>
  )
}
