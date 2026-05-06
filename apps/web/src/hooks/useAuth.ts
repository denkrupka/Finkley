import { useContext } from 'react'

import { AuthContext, type AuthContextValue } from '@/components/auth/AuthContext'

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) {
    throw new Error('useAuth must be used inside <AuthProvider>')
  }
  return ctx
}

export type { AuthContextValue }
