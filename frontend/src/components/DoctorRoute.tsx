import React from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../state/auth'

/** Pages of the doctor side: only for an account that is a doctor. */
export function DoctorRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth()
  if (loading) return <div className="p-6 text-sm font-bold text-duo-mute">Đang tải...</div>
  if (!user) return <Navigate to="/login" replace />
  if (!user.doctor) return <Navigate to="/" replace />
  return <>{children}</>
}
