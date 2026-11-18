import { createContext, useContext } from 'react'
import type { User } from '../lib/types'

export type AuthState = {
  token: string | null
  user: User | null
  loading: boolean
  login: (email: string, password: string) => Promise<void>
  register: (name: string, email: string, password: string) => Promise<void>
  logout: () => Promise<void>
  refreshMe: () => Promise<void>
  updateUser: (user: User) => void
}

// Kept apart from the provider component so that file only exports a
// component (React Fast Refresh needs that to hot-reload it).
export const AuthContext = createContext<AuthState | null>(null)

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
