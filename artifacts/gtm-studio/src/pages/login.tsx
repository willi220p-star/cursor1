import { useState, type FormEvent } from 'react';
import { CircleAlert, Eye, EyeOff, TriangleAlert } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { signInWithEmail } from '@/studio/auth';
import { supabaseConfigured } from '@/studio/cloud';
import { ThemeButton } from '@/app/shell';
import { publicAssetUrl } from '@/lib/public-url';

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
          <div className="flex items-center justify-between gap-4">
            <p className="brand-lockup"><span className="brand-mark">DGK</span><span className="brand-name">Outbound Studio</span></p>
            <ThemeButton />
          </div>
          <div className="login-body">
            <h1 className="display login-title">Welcome back.</h1>
            {!supabaseConfigured && (
              <Alert className="mt-6 border-warning/40 bg-warning/10 text-foreground [&>svg]:text-warning">
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
                  className="field h-12"
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
                    className="field h-12"
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
                    className="btn btn-quiet h-12 w-12 flex-none px-0"
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
              <button type="submit" className="btn btn-primary h-12 w-full text-base" disabled={disabled} data-loading={busy || undefined} aria-busy={busy || undefined}>
                {busy ? 'Signing in…' : 'Sign in'}
              </button>
            </form>
            <p className="mt-6 text-sm leading-relaxed text-muted-foreground">
              Invite only. Ask an admin to add you in Supabase Auth. Prospect lists stay in this browser until you save a campaign.
            </p>
          </div>
        </div>
        <div className="login-preview desk-scene" aria-hidden="true" style={{ backgroundImage: `url(${publicAssetUrl('/desk/walnut.png')})` }}>
          <div className="desk-paper login-note">
            {'Hi Maya,\n\nLoved what Top End Solar is building. One idea could help a Director in Darwin start more good conversations.\n\nWorth a quick chat next week?\n\nAlex'}
          </div>
        </div>
      </div>
    </div>
  );
}
