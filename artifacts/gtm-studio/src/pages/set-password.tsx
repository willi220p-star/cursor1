import { useState, type FormEvent } from 'react';
import { CircleAlert, Eye, EyeOff } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { MIN_PASSWORD_LENGTH, setPassword } from '@/studio/auth';

/** Shown once after someone opens an invite or password-reset link, before they enter the app. */
export function SetPasswordPage({ email, onDone }: { email?: string; onDone: () => void }) {
  const [password, setValue] = useState('');
  const [confirm, setConfirm] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    if (password !== confirm) {
      setError('The two passwords are different.');
      return;
    }
    setBusy(true);
    const result = await setPassword(password);
    setBusy(false);
    if (result.error) setError(result.error);
    else onDone();
  };

  return (
    <div className="login-shell">
      <div className="login-grid">
        <div className="login-panel animate-rise">
          <p className="brand-lockup"><span className="brand-mark">DGK</span><span className="brand-name">Outbound Studio</span></p>
          <div className="login-body">
            <h1 className="display login-title">Choose a password.</h1>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
              {email ? <>You are signed in as <strong>{email}</strong>. </> : null}
              Pick a password so you can sign in next time. Use at least {MIN_PASSWORD_LENGTH} characters.
            </p>
            <form className="mt-8 flex flex-col gap-5" onSubmit={onSubmit} noValidate>
              <div className="field-row">
                <label className="label" htmlFor="new-password">New password</label>
                <div className="flex items-stretch gap-2">
                  <input
                    id="new-password"
                    className="field h-12"
                    type={show ? 'text' : 'password'}
                    autoComplete="new-password"
                    required
                    minLength={MIN_PASSWORD_LENGTH}
                    value={password}
                    onChange={(event) => setValue(event.target.value)}
                  />
                  <button
                    type="button"
                    className="btn btn-quiet h-12 w-12 flex-none px-0"
                    aria-label={show ? 'Hide password' : 'Show password'}
                    aria-pressed={show}
                    onClick={() => setShow((value) => !value)}
                  >
                    {show ? <EyeOff size={18} aria-hidden /> : <Eye size={18} aria-hidden />}
                  </button>
                </div>
              </div>
              <div className="field-row">
                <label className="label" htmlFor="confirm-password">Type it again</label>
                <input
                  id="confirm-password"
                  className="field h-12"
                  type={show ? 'text' : 'password'}
                  autoComplete="new-password"
                  required
                  value={confirm}
                  onChange={(event) => setConfirm(event.target.value)}
                />
                {error && (
                  <Alert variant="destructive" role="alert" className="mt-3 border-destructive/40 bg-destructive/5">
                    <CircleAlert size={16} aria-hidden />
                    <AlertTitle>Could not save the password</AlertTitle>
                    <AlertDescription>{error}</AlertDescription>
                  </Alert>
                )}
              </div>
              <button type="submit" className="btn btn-primary h-12 w-full text-base" disabled={busy} aria-busy={busy || undefined}>
                {busy ? 'Saving…' : 'Save password and continue'}
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
