import type { Session } from '@supabase/supabase-js'
import { supabase, supabaseConfigured } from '@/services/supabase/client'

const missingConfig =
  'Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY on Vercel.'

export async function getCurrentSession(): Promise<{
  data: Session | null
  error: string | null
}> {
  if (!supabaseConfigured || !supabase) {
    return { data: null, error: null }
  }
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
  if (!supabaseConfigured || !supabase) {
    return { data: null, error: missingConfig }
  }
  const { data, error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) {
    return { data: null, error: error.message }
  }
  return { data: data.session ? { session: data.session } : null, error: null }
}

export async function signOut(): Promise<{ error: string | null }> {
  if (!supabaseConfigured || !supabase) {
    return { error: null }
  }
  const { error } = await supabase.auth.signOut()
  return { error: error ? error.message : null }
}

export function onAuthStateChange(callback: (session: Session | null) => void) {
  if (!supabase) {
    return () => undefined
  }
  const { data } = supabase.auth.onAuthStateChange((_event, session) => {
    callback(session)
  })
  return () => data.subscription.unsubscribe()
}
