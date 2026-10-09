import { useSyncExternalStore } from 'react';

export type ThemePreference = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

// index.html reads the same key before first paint, so keep the two in step.
const STORAGE_KEY = 'gtm-studio-theme';
const listeners = new Set<() => void>();
const media = typeof window !== 'undefined' && window.matchMedia
  ? window.matchMedia('(prefers-color-scheme: dark)')
  : null;

function readPreference(): ThemePreference {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'light' || stored === 'dark' || stored === 'system') return stored;
  } catch {
    // Storage can be blocked (private mode); fall back to the device setting.
  }
  return 'system';
}

let preference: ThemePreference = readPreference();

function resolve(pref: ThemePreference): ResolvedTheme {
  if (pref === 'system') return media?.matches ? 'dark' : 'light';
  return pref;
}

function apply() {
  if (typeof document === 'undefined') return;
  const resolved = resolve(preference);
  document.documentElement.dataset.theme = resolved;
  document.documentElement.style.colorScheme = resolved;
}

function emit() {
  apply();
  listeners.forEach((listener) => listener());
}

media?.addEventListener('change', () => {
  if (preference === 'system') emit();
});

export function setThemePreference(next: ThemePreference) {
  preference = next;
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // Not persisted; the choice still applies for this visit.
  }
  emit();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useTheme() {
  const pref = useSyncExternalStore(subscribe, () => preference, () => 'system' as ThemePreference);
  const resolved = useSyncExternalStore(subscribe, () => resolve(preference), () => 'light' as ResolvedTheme);
  return { preference: pref, resolved, setPreference: setThemePreference };
}

apply();
