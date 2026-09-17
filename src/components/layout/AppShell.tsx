import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { Mark } from '@/components/brand/Mark'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/hooks/use-auth'
import { BRAND } from '@/lib/brand'
import { cn } from '@/lib/utils'

const navItems = [
  { to: '/', label: 'Dashboard', end: true },
  { to: '/handwritten', label: 'Handwritten', end: false },
  { to: '/memes', label: 'Memes', end: false },
]

export function AppShell() {
  const { user, signOutUser } = useAuth()
  const navigate = useNavigate()

  async function handleSignOut() {
    const error = await signOutUser()
    if (!error) {
      navigate('/login', { replace: true })
    }
  }

  return (
    <div className="min-h-svh bg-warm-cream">
      <header className="border-b border-sand-border bg-paper-white">
        <div className="mx-auto flex max-w-[1200px] items-center justify-between gap-4 px-4 py-4 sm:px-6">
          <div className="flex items-center gap-3">
            <Mark />
            <div>
              <p className="text-sm font-semibold text-navy-ink">{BRAND.product}</p>
              <p className="text-xs text-stone-gray">{BRAND.name}</p>
            </div>
          </div>

          <nav className="hidden items-center gap-1 md:flex">
            {navItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  cn(
                    'rounded-[1584px] px-4 py-2 text-sm font-medium transition-colors',
                    isActive
                      ? 'bg-cool-mist text-navy-ink'
                      : 'text-stone-gray hover:bg-cool-mist hover:text-navy-ink',
                  )
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>

          <div className="flex items-center gap-3">
            <p className="hidden max-w-[180px] truncate text-xs text-stone-gray sm:block">
              {user?.email}
            </p>
            <Button variant="secondary" size="sm" onClick={() => void handleSignOut()}>
              Sign out
            </Button>
          </div>
        </div>

        <nav className="flex gap-1 overflow-x-auto border-t border-sand-border px-4 py-2 md:hidden">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                cn(
                  'whitespace-nowrap rounded-[1584px] px-4 py-2 text-sm font-medium',
                  isActive
                    ? 'bg-cool-mist text-navy-ink'
                    : 'text-stone-gray hover:bg-cool-mist hover:text-navy-ink',
                )
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
      </header>

      <main className="mx-auto w-full max-w-[1200px] px-4 py-8 sm:px-6 sm:py-10">
        <Outlet />
      </main>
    </div>
  )
}
