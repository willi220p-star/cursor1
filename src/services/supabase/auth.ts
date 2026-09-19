import type { Session } from '@supabase/supabase-js'
import { supabase } from '@/services/supabase/client'

export async function getCurrentSession(): Promise<{
  data: Session | null
  error: string | null
}> {
  const { data, error } = await supabase.auth.getSession()
  if (error) {
    return { data: null, error: error.message }
  }
  return { data: data.session, error: null }
}

export async function signInWithEmail(
  email: string,
  password: string,
): Promise<{ data: { session: Session } | null; error: string | null }> {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) {
    return { data: null, error: error.message }
  }
  return { data: data.session ? { session: data.session } : null, error: null }
}

export async function signOut(): Promise<{ error: string | null }> {
  const { error } = await supabase.auth.signOut()
  return { error: error ? error.message : null }
}

export function onAuthStateChange(callback: (session: Session | null) => void) {
  const { data } = supabase.auth.onAuthStateChange((_event, session) => {
    callback(session)
  })
  return () => data.subscription.unsubscribe()
}
