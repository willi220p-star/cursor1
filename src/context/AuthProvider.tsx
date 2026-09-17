import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { AuthContext } from '@/context/auth-context'
import { getCurrentSession, signInWithEmail, signOut } from '@/services/supabase/auth'
import { supabase } from '@/services/supabase/client'

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true

    void getCurrentSession().then((result) => {
      if (!active) return
      if (result.error) {
        setError(result.error)
        setSession(null)
      } else {
        setError(null)
        setSession(result.data)
      }
      setLoading(false)
    })

    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession)
      setError(null)
      setLoading(false)
    })

    return () => {
      active = false
      data.subscription.unsubscribe()
    }
  }, [])

  const signIn = useCallback(async (email: string, password: string) => {
    const result = await signInWithEmail(email, password)
    if (result.error || !result.data) {
      const message = result.error ?? 'Sign-in succeeded but no session was returned.'
      setError(message)
      return message
    }
    setSession(result.data.session)
    setError(null)
    return null
  }, [])

  const signOutUser = useCallback(async () => {
    const result = await signOut()
    if (result.error) {
      setError(result.error)
      return result.error
    }
    setSession(null)
    setError(null)
    return null
  }, [])

  const value = useMemo(
    () => ({
      session,
      user: session?.user ?? null,
      loading,
      error,
      signIn,
      signOutUser,
    }),
    [session, loading, error, signIn, signOutUser],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
