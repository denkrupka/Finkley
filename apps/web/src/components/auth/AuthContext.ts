import { createContext } from 'react'
import type { Session, User } from '@supabase/supabase-js'

export type AuthContextValue = {
  user: User | null
  session: Session | null
  /**
   * `true` пока не отработал первый `getSession` после маунта.
   * Не путать с pending-состоянием конкретных операций (signIn/signUp).
   */
  loading: boolean
  signInWithPassword: (email: string, password: string) => Promise<{ error: Error | null }>
  signUpWithPassword: (
    email: string,
    password: string,
    options?: { fullName?: string },
  ) => Promise<{ error: Error | null; needsEmailConfirmation: boolean }>
  signInWithOAuth: (provider: 'google' | 'facebook' | 'apple') => Promise<{ error: Error | null }>
  resetPasswordForEmail: (email: string) => Promise<{ error: Error | null }>
  updatePassword: (newPassword: string) => Promise<{ error: Error | null }>
  signOut: () => Promise<void>
}

export const AuthContext = createContext<AuthContextValue | null>(null)
