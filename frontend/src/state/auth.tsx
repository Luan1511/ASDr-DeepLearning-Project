import React, { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { api, onUnauthorized, setAuthToken } from '../lib/api'
import type { User } from '../lib/types'

type AuthState = {
  token: string | null
  user: User | null
  loading: boolean
  login: (email: string, password: string) => Promise<void>
  register: (name: string, email: string, password: string) => Promise<void>
  logout: () => Promise<void>
  refreshMe: () => Promise<void>
}

const AuthContext = createContext<AuthState | null>(null)

const TOKEN_KEY = 'asdr_token'

export function AuthProvider({ children }: { children: React.ReactNode }) {
  // The Axios header is set synchronously together with the token: child
  // components fire their requests in effects that run BEFORE this provider's
  // effects, so syncing the header in a useEffect sent the first requests
  // after login without a token (401).
  const [token, setToken] = useState<string | null>(() => {
    const stored = localStorage.getItem(TOKEN_KEY)
    setAuthToken(stored)
    return stored
  })
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState<boolean>(true)

  // An expired token anywhere in the app logs the user out (ProtectedRoute
  // then redirects to /login) instead of leaving pages with silent errors.
  useEffect(() => {
    onUnauthorized(() => {
      setAuthToken(null)
      setUser(null)
      setToken(null)
      localStorage.removeItem(TOKEN_KEY)
    })
    return () => onUnauthorized(null)
  }, [])

  async function refreshMe() {
    if (!token) {
      setUser(null)
      setLoading(false)
      return
    }
    try {
      setLoading(true)
      const res = await api.get('/auth/me')
      setUser(res.data.user)
    } catch {
      setAuthToken(null)
      setUser(null)
      setToken(null)
      localStorage.removeItem(TOKEN_KEY)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    refreshMe()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function login(email: string, password: string) {
    const res = await api.post('/auth/login', { email, password })
    setAuthToken(res.data.token)
    setToken(res.data.token)
    localStorage.setItem(TOKEN_KEY, res.data.token)
    setUser(res.data.user)
  }

  async function register(name: string, email: string, password: string) {
    await api.post('/auth/register', { name, email, password })
    await login(email, password)
  }

  async function logout() {
    try {
      await api.post('/auth/logout')
    } catch {
      // ignore
    }
    setAuthToken(null)
    setUser(null)
    setToken(null)
    localStorage.removeItem(TOKEN_KEY)
  }

  const value = useMemo<AuthState>(
    () => ({ token, user, loading, login, register, logout, refreshMe }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [token, user, loading],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
