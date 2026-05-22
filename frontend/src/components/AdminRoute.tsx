import React from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../state/auth'

export function AdminRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth()
  if (loading) return <div className="p-6 text-sm text-slate-600">Đang tải...</div>
  if (!user) return <Navigate to="/login" replace />
  if (user.role !== 'ADMIN') return <Navigate to="/" replace />
  return <>{children}</>
}
