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

const SET_PASSWORD_KEY = 'gtm-set-password';
const LINK_ERROR_KEY = 'gtm-link-error';

function readFlag(key: string) {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function clearFlag(key: string) {
  try {
    sessionStorage.removeItem(key);
  } catch {
    // Storage blocked: nothing to clear.
  }
}

/** True right after someone opens an invite or password-reset link: they still have to choose a password. */
export function needsPasswordSetup() {
  return readFlag(SET_PASSWORD_KEY) === '1';
}

export function clearPasswordSetup() {
  clearFlag(SET_PASSWORD_KEY);
}

/** The reason an invite or reset link failed (e.g. otp_expired), read once, or null. */
export function takeLinkError() {
  const code = readFlag(LINK_ERROR_KEY);
  clearFlag(LINK_ERROR_KEY);
  return code;
}

export function linkErrorMessage(code: string) {
  if (code === 'otp_expired') {
    return 'That link has expired or was already used. Choose “Forgot password?” below to get a new one, or ask DGK to re-send your invite.';
  }
  return 'That link did not work. Choose “Forgot password?” below to get a new one, or ask DGK to re-send your invite.';
}

export const MIN_PASSWORD_LENGTH = 8;

export async function setPassword(password: string): Promise<{ error: string | null }> {
  if (!supabase) return { error: authUnavailableMessage() };
  if (password.length < MIN_PASSWORD_LENGTH) return { error: `Use at least ${MIN_PASSWORD_LENGTH} characters.` };
  const { error } = await supabase.auth.updateUser({ password });
  if (error) return { error: error.message };
  clearPasswordSetup();
  return { error: null };
}

/** Emails a link that lets the person choose a new password. Always reports success so emails are not leaked. */
export async function sendPasswordReset(email: string): Promise<{ error: string | null }> {
  if (!supabase) return { error: authUnavailableMessage() };
  const redirectTo = `${window.location.origin}${import.meta.env.BASE_URL}`;
  const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });
  if (error && /rate|too many|seconds/i.test(error.message)) return { error: 'Please wait a minute before asking for another link.' };
  return { error: null };
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
