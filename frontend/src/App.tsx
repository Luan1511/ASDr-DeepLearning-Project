import { Suspense, lazy } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { ProtectedRoute } from './components/ProtectedRoute'
import { AdminRoute } from './components/AdminRoute'
import { LoginPage } from './pages/LoginPage'
import { RegisterPage } from './pages/RegisterPage'
import { HomePage } from './pages/HomePage'
import { ScreeningPage } from './pages/ScreeningPage'
import { HistoryPage } from './pages/HistoryPage'
import { AssistantPage } from './pages/AssistantPage'
import { KnowledgePage } from './pages/KnowledgePage'
import { ArticlePage } from './pages/ArticlePage'
import { GuidePage } from './pages/GuidePage'
import { SettingsPage } from './pages/SettingsPage'
import { ChildrenPage } from './pages/ChildrenPage'
import { ChildDetailPage } from './pages/ChildDetailPage'

// Heavier, less used screens load on demand (keeps the first bundle small).
const AdminPage = lazy(() => import('./pages/AdminPage').then((m) => ({ default: m.AdminPage })))
const AdminSkeletonPage = lazy(() => import('./pages/AdminSkeletonPage').then((m) => ({ default: m.AdminSkeletonPage })))
const ExercisesPage = lazy(() => import('./pages/ExercisesPage').then((m) => ({ default: m.ExercisesPage })))
const ExercisePracticePage = lazy(() => import('./pages/ExercisePracticePage').then((m) => ({ default: m.ExercisePracticePage })))
const ExerciseSessionPage = lazy(() => import('./pages/ExerciseSessionPage').then((m) => ({ default: m.ExerciseSessionPage })))
const AdminExercisesPage = lazy(() => import('./pages/AdminExercisesPage').then((m) => ({ default: m.AdminExercisesPage })))
const AdminExerciseEditPage = lazy(() => import('./pages/AdminExerciseEditPage').then((m) => ({ default: m.AdminExerciseEditPage })))
const AdminRecorderProbePage = lazy(() => import('./pages/AdminRecorderProbePage').then((m) => ({ default: m.AdminRecorderProbePage })))
const QuestionnairesPage = lazy(() => import('./pages/QuestionnairesPage').then((m) => ({ default: m.QuestionnairesPage })))
const QuestionnaireEntryPage = lazy(() => import('./pages/QuestionnaireEntryPage').then((m) => ({ default: m.QuestionnaireEntryPage })))
const QuestionnaireResultPage = lazy(() => import('./pages/QuestionnaireResultPage').then((m) => ({ default: m.QuestionnaireResultPage })))
const QuestionnaireFollowUpPage = lazy(() =>
  import('./pages/QuestionnaireFollowUpPage').then((m) => ({ default: m.QuestionnaireFollowUpPage })),
)
const CommunityPage = lazy(() => import('./pages/CommunityPage').then((m) => ({ default: m.CommunityPage })))
const CommunityPostDetailPage = lazy(() =>
  import('./pages/CommunityPostDetailPage').then((m) => ({ default: m.CommunityPostDetailPage })),
)

function PageFallback() {
  return <div className="p-8 text-sm font-semibold text-duo-mute">Đang tải...</div>
}

export default function App() {
  return (
    <Suspense fallback={<PageFallback />}>
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />

      <Route
        path="/"
        element={
          <ProtectedRoute>
            <HomePage />
          </ProtectedRoute>
        }
      />

      <Route
        path="/screening"
        element={
          <ProtectedRoute>
            <ScreeningPage />
          </ProtectedRoute>
        }
      />

      <Route
        path="/history"
        element={
          <ProtectedRoute>
            <HistoryPage />
          </ProtectedRoute>
        }
      />

      <Route
        path="/children"
        element={
          <ProtectedRoute>
            <ChildrenPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/children/:id"
        element={
          <ProtectedRoute>
            <ChildDetailPage />
          </ProtectedRoute>
        }
      />

      <Route
        path="/exercises"
        element={
          <ProtectedRoute>
            <ExercisesPage />
          </ProtectedRoute>
        }
      />
      {/* Kid mode: full screen, no dashboard chrome. */}
      <Route
        path="/exercises/:exerciseId/practice"
        element={
          <ProtectedRoute>
            <ExercisePracticePage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/exercise-sessions/:id"
        element={
          <ProtectedRoute>
            <ExerciseSessionPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/questionnaires"
        element={
          <ProtectedRoute>
            <QuestionnairesPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/children/:id/questionnaires/mchat"
        element={
          <ProtectedRoute>
            <QuestionnaireEntryPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/questionnaire-responses/:id"
        element={
          <ProtectedRoute>
            <QuestionnaireResultPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/questionnaire-responses/:id/follow-up"
        element={
          <ProtectedRoute>
            <QuestionnaireFollowUpPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/community"
        element={
          <ProtectedRoute>
            <CommunityPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/community/post/:id"
        element={
          <ProtectedRoute>
            <CommunityPostDetailPage />
          </ProtectedRoute>
        }
      />

      <Route
        path="/assistant"
        element={
          <ProtectedRoute>
            <AssistantPage />
          </ProtectedRoute>
        }
      />

      <Route
        path="/knowledge"
        element={
          <ProtectedRoute>
            <KnowledgePage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/knowledge/:slug"
        element={
          <ProtectedRoute>
            <ArticlePage />
          </ProtectedRoute>
        }
      />

      <Route
        path="/guide"
        element={
          <ProtectedRoute>
            <GuidePage />
          </ProtectedRoute>
        }
      />

      <Route
        path="/settings"
        element={
          <ProtectedRoute>
            <SettingsPage />
          </ProtectedRoute>
        }
      />

      <Route
        path="/admin"
        element={
          <AdminRoute>
            <AdminPage />
          </AdminRoute>
        }
      />

      <Route
        path="/admin/skeleton"
        element={
          <AdminRoute>
            <AdminSkeletonPage />
          </AdminRoute>
        }
      />

      <Route
        path="/admin/exercises"
        element={
          <AdminRoute>
            <AdminExercisesPage />
          </AdminRoute>
        }
      />
      <Route
        path="/admin/exercises/recorder-probe"
        element={
          <AdminRoute>
            <AdminRecorderProbePage />
          </AdminRoute>
        }
      />
      <Route
        path="/admin/exercises/:id"
        element={
          <AdminRoute>
            <AdminExerciseEditPage />
          </AdminRoute>
        }
      />

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
    </Suspense>
  )
}
