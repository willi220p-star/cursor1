import { useState, type FormEvent } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { Mark } from '@/components/brand/Mark'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useAuth } from '@/hooks/use-auth'
import { BRAND } from '@/lib/brand'

export function LoginPage() {
  const { session, loading, signIn } = useAuth()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [formError, setFormError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  if (!loading && session) {
    return <Navigate to="/" replace />
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSubmitting(true)
    setFormError(null)
    const error = await signIn(email.trim(), password)
    setSubmitting(false)
    if (error) {
      setFormError(error)
      return
    }
    navigate('/', { replace: true })
  }

  return (
    <div className="flex min-h-svh items-center justify-center bg-warm-cream px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-8 flex items-center gap-3">
          <Mark />
          <div>
            <p className="text-sm font-semibold text-navy-ink">{BRAND.product}</p>
            <p className="text-xs text-stone-gray">{BRAND.name}</p>
          </div>
        </div>

        <div className="rounded-[12px] border border-sand-border bg-paper-white p-6 shadow-card sm:p-8">
          <h1 className="heading-display text-[28px] font-semibold text-navy-ink">
            Sign in
          </h1>
          <p className="mt-2 text-sm text-stone-gray">
            {BRAND.tagline}
          </p>

          <form className="mt-6 flex flex-col gap-4" onSubmit={(event) => void handleSubmit(event)}>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="email" className="text-sm font-medium text-navy-ink">
                Email
              </label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="you@company.com"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label htmlFor="password" className="text-sm font-medium text-navy-ink">
                Password
              </label>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="••••••••"
              />
            </div>

            {formError ? (
              <p role="alert" className="text-sm text-[#7a1f1f]">
                {formError}
              </p>
            ) : null}

            <Button type="submit" disabled={submitting} className="mt-2 w-full">
              {submitting ? 'Signing in…' : 'Sign in'}
            </Button>
          </form>
        </div>

        <p className="mt-6 text-center text-xs text-ash-gray">
          Internal tool. Access is limited to invited team members.
        </p>
      </div>
    </div>
  )
}
