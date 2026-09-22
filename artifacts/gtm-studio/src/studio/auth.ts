import type { Session, User } from '@supabase/supabase-js';
import { supabase } from '@/studio/cloud';

export type AuthResult = { data: Session | null; error: string | null };

export function authUnavailableMessage() {
  return 'Supabase is not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY, then reload.';
}

export async function getCurrentSession(): Promise<AuthResult> {
  if (!supabase) return { data: null, error: authUnavailableMessage() };
  const { data, error } = await supabase.auth.getSession();
  if (error) return { data: null, error: error.message };
  return { data: data.session, error: null };
}

export async function signInWithEmail(email: string, password: string): Promise<AuthResult> {
  if (!supabase) return { data: null, error: authUnavailableMessage() };
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return { data: null, error: error.message };
  if (!data.session) return { data: null, error: 'Sign-in succeeded but no session was returned.' };
  return { data: data.session, error: null };
}

export async function signOutUser() {
  if (!supabase) return { error: authUnavailableMessage() };
  const { error } = await supabase.auth.signOut();
  return { error: error?.message ?? null };
}

export function onAuthChange(handler: (user: User | null) => void) {
  if (!supabase) return () => undefined;
  const { data } = supabase.auth.onAuthStateChange((_event, session) => {
    handler(session?.user ?? null);
  });
  return () => data.subscription.unsubscribe();
}
