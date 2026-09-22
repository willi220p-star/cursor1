import { useState, type FormEvent } from 'react';
import { CircleAlert, Eye, EyeOff, LockKeyhole, PenLine, TriangleAlert } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { signInWithEmail } from '@/studio/auth';
import { supabaseConfigured } from '@/studio/cloud';

function friendlyAuthError(raw: string) {
  const lower = raw.toLowerCase();
  if (lower.includes('invalid login') || lower.includes('invalid credentials') || lower.includes('invalid_grant')) {
    return 'We couldn’t sign you in. Check the email and password, or ask an admin to re-send your invite.';
  }
  if (lower.includes('email not confirmed')) {
    return 'This account has not confirmed its email yet. Open the invite email and follow the link, then sign in again.';
  }
  if (lower.includes('rate') || lower.includes('too many')) {
    return 'Too many attempts in a row. Wait a minute, then try again.';
  }
  if (lower.includes('network') || lower.includes('fetch')) {
    return 'The sign-in service could not be reached. Check your connection and try again.';
  }
  return `We couldn’t sign you in: ${raw}. Check the details or ask an admin to re-send your invite.`;
}

export function LoginPage({ bootError }: { bootError?: string | null }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState(bootError ? friendlyAuthError(bootError) : '');
  const [busy, setBusy] = useState(false);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    setBusy(true);
    const result = await signInWithEmail(email.trim(), password);
    setBusy(false);
    if (result.error) setError(friendlyAuthError(result.error));
  };

  const disabled = busy || !supabaseConfigured;

  return (
    <div className="login-shell">
      <div className="login-grid">
        <div className="login-panel animate-rise">
          <div className="flex items-center gap-4">
            <span className="flex h-10 w-10 flex-none items-center justify-center rounded-md bg-primary text-primary-foreground">
              <PenLine size={20} aria-hidden />
            </span>
            <div>
              <p className="eyebrow">DGK Business Consultancy</p>
              <h1 className="display mt-1 text-[32px] font-semibold leading-[1.15]">Outbound Studio</h1>
            </div>
          </div>
          <p className="mt-5 text-base leading-relaxed text-muted-foreground">
            Invite-only. Ask an admin to add you in Supabase Auth.
          </p>
          {!supabaseConfigured && (
            <Alert className="mt-5 border-warning/40 bg-warning/10 text-foreground [&>svg]:text-warning">
              <TriangleAlert size={16} aria-hidden />
              <AlertTitle>Sign-in is not configured here</AlertTitle>
              <AlertDescription>
                Add <code className="mono rounded bg-surface-2 px-1 text-sm">VITE_SUPABASE_URL</code> and
                {' '}<code className="mono rounded bg-surface-2 px-1 text-sm">VITE_SUPABASE_ANON_KEY</code> (or the publishable key) to the environment, then reload.
              </AlertDescription>
            </Alert>
          )}
          <form className="mt-8 flex flex-col gap-5" onSubmit={onSubmit} noValidate>
            <div className="field-row">
              <label className="label" htmlFor="login-email">Work email</label>
              <input
                id="login-email"
                className="field h-11"
                type="email"
                autoComplete="username"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="you@dgkbusinessconsultancy.com"
                aria-invalid={Boolean(error) || undefined}
              />
            </div>
            <div className="field-row">
              <label className="label" htmlFor="login-password">Password</label>
              <div className="flex items-stretch gap-2">
                <input
                  id="login-password"
                  className="field h-11"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  aria-invalid={Boolean(error) || undefined}
                  aria-describedby={error ? 'login-error' : undefined}
                />
                <button
                  type="button"
                  className="btn btn-quiet h-11 w-11 flex-none px-0"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  aria-pressed={showPassword}
                  onClick={() => setShowPassword((value) => !value)}
                >
                  {showPassword ? <EyeOff size={18} aria-hidden /> : <Eye size={18} aria-hidden />}
                </button>
              </div>
              {error && (
                <Alert id="login-error" variant="destructive" className="mt-3 border-destructive/40 bg-destructive/5">
                  <CircleAlert size={16} aria-hidden />
                  <AlertTitle>Sign-in failed</AlertTitle>
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}
            </div>
            <button type="submit" className="btn btn-primary btn-lg w-full" disabled={disabled} data-loading={busy || undefined} aria-busy={busy || undefined}>
              <LockKeyhole size={16} aria-hidden />
              {busy ? 'Signing in…' : 'Sign in'}
            </button>
          </form>
          <p className="mt-6 text-sm leading-relaxed text-muted-foreground">
            Prospect lists stay in this browser until you explicitly save a campaign. Darwin / NT workspace.
          </p>
        </div>
        <div className="login-preview" aria-hidden="true">
          <div className="login-note">
            Hi Maya,<br />
            Loved what Top End Solar is building. One idea that could help a Director in Darwin create more qualified conversations.<br />
            Worth a quick chat next week?<br />
            <span className="mt-2 block text-right not-italic">– Alex</span>
          </div>
          <p className="login-note-caption">One list in. A written note, a portrait card or a moving meme for every row.</p>
        </div>
      </div>
    </div>
  );
}
