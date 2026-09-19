import { Navigate, Outlet } from 'react-router-dom'
import { useAuth } from '@/hooks/use-auth'
import { supabaseConfigured } from '@/services/supabase/client'

export function ProtectedRoute() {
  const { session, loading, error } = useAuth()

  if (loading) {
    return (
      <div className="flex min-h-svh items-center justify-center bg-warm-cream">
        <p className="text-sm text-stone-gray">Checking your session…</p>
      </div>
    )
  }

  if (!supabaseConfigured) {
    return <Outlet />
  }

  if (error && !session) {
    return (
      <div className="flex min-h-svh items-center justify-center bg-warm-cream px-4">
        <div className="w-full max-w-md rounded-[12px] border border-sand-border bg-paper-white p-6 shadow-card">
          <h1 className="heading-display text-[32px] font-semibold text-navy-ink">
            Cannot reach auth
          </h1>
          <p className="mt-3 max-w-[65ch] text-sm text-stone-gray">{error}</p>
        </div>
      </div>
    )
  }

  if (!session) {
    return <Navigate to="/login" replace />
  }

  return <Outlet />
}
