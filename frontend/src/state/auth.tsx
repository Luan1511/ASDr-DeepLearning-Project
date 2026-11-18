import React, { useEffect, useMemo, useState } from 'react'
import { api, onUnauthorized, setAuthToken } from '../lib/api'
import type { User } from '../lib/types'
import { AuthContext, type AuthState } from './useAuth'

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
  // Without a stored token there is no session to restore, so nothing is loading.
  const [loading, setLoading] = useState<boolean>(() => localStorage.getItem(TOKEN_KEY) !== null)

  function clearSession() {
    setAuthToken(null)
    setUser(null)
    setToken(null)
    localStorage.removeItem(TOKEN_KEY)
  }

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
      clearSession()
    } finally {
      setLoading(false)
    }
  }

  // Restore the session of the stored token once, on first mount.
  useEffect(() => {
    if (!token) return
    let stale = false
    api
      .get('/auth/me')
      .then(
        (res) => {
          if (!stale) setUser(res.data.user)
        },
        () => {
          if (!stale) clearSession()
        },
      )
      .finally(() => {
        if (!stale) setLoading(false)
      })
    return () => {
      stale = true
    }
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
    clearSession()
  }

  function updateUser(updated: User) {
    setUser(updated)
  }

  const value = useMemo<AuthState>(
    () => ({ token, user, loading, login, register, logout, refreshMe, updateUser }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [token, user, loading],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
