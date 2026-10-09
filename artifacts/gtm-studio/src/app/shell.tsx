import { useEffect, useState, type ReactNode } from 'react';
import type { User } from '@supabase/supabase-js';
import { LogOut, Menu, Moon, Search, Settings2, Sun } from 'lucide-react';
import { Link, useLocation } from 'wouter';
import { CommandPalette } from '@/components/command-palette';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import { useTheme } from '@/lib/theme';
import { signOutUser } from '@/studio/auth';
import { supabaseConfigured } from '@/studio/cloud';
import { studios } from '@/studio/studios';

const tabs = [{ key: 'desk', href: '/', label: 'Desk' }, ...studios.map(({ key, href, label }) => ({ key, href, label }))];

export function BrandLockup() {
  return (
    <Link href="/" className="brand-lockup" aria-label="Outbound Studio, go to the desk">
      <span className="brand-mark">DGK</span>
      <span className="brand-name">Outbound Studio</span>
    </Link>
  );
}

function StudioTabs({ location, onNavigate }: { location: string; onNavigate?: () => void }) {
  return (
    <>
      {tabs.map((tab) => (
        <Link
          key={tab.key}
          href={tab.href}
          onClick={onNavigate}
          data-studio={tab.key}
          aria-current={location === tab.href ? 'page' : undefined}
          className="studio-tab"
        >
          {tab.key !== 'desk' && <span className="studio-dot" aria-hidden />}
          {tab.label}
        </Link>
      ))}
    </>
  );
}

export function ThemeButton() {
  const { resolved, setPreference } = useTheme();
  const next = resolved === 'dark' ? 'light' : 'dark';
  return (
    <button type="button" className="round-btn" aria-label={`Switch to ${next} mode`} onClick={() => setPreference(next)}>
      {resolved === 'dark' ? <Sun size={17} aria-hidden /> : <Moon size={17} aria-hidden />}
    </button>
  );
}

export function Shell({ children, user }: { children: ReactNode; user: User }) {
  const [location] = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const email = user.email ?? 'Operator';
  const initials = email.slice(0, 2).toUpperCase();

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setSearchOpen((value) => !value);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="shell-frame">
      <a href="#main" className="skip-link">Skip to content</a>
      <header className="topnav">
        <div className="topnav-inner">
          <button type="button" aria-label="Open navigation" className="round-btn mobile-menu-btn" onClick={() => setMobileOpen(true)}>
            <Menu size={18} aria-hidden />
          </button>
          <BrandLockup />
          <nav className="studio-tabs" aria-label="Studios">
            <StudioTabs location={location} />
          </nav>
          <div className="nav-actions">
            <button type="button" className="nav-search" onClick={() => setSearchOpen(true)} aria-label="Search, shortcut Command K">
              <Search size={15} aria-hidden />
              <span className="hidden lg:inline">Search</span>
              <kbd className="hidden lg:inline">⌘K</kbd>
            </button>
            <ThemeButton />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button type="button" className="avatar-btn" aria-label={`Account menu for ${email}`}>{initials}</button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-60 border-border bg-popover">
                <DropdownMenuLabel className="flex flex-col gap-2 py-2">
                  <span className="truncate text-sm font-semibold">{email}</span>
                  <span className="status-chip w-fit" role="status">
                    <span className={`dot ${supabaseConfigured ? 'is-live' : 'is-local'}`} aria-hidden />
                    <span className="status-chip-text">{supabaseConfigured ? 'Live sync' : 'Local only'}</span>
                  </span>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild className="min-h-11">
                  <Link href="/settings"><Settings2 aria-hidden /> Settings</Link>
                </DropdownMenuItem>
                <DropdownMenuItem className="min-h-11" onSelect={() => void signOutUser()}>
                  <LogOut aria-hidden /> Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </header>
      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent side="left" className="w-[300px] border-border bg-background p-5 sm:max-w-[300px] [&>button]:h-11 [&>button]:w-11 [&>button]:opacity-100 [&>button>svg]:mx-auto [&>button>svg]:h-5 [&>button>svg]:w-5">
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          <SheetDescription className="sr-only">Move between the desk and the studios.</SheetDescription>
          <div className="mb-6"><BrandLockup /></div>
          <nav className="sheet-nav" aria-label="Studios">
            <StudioTabs location={location} onNavigate={() => setMobileOpen(false)} />
            <Link href="/settings" onClick={() => setMobileOpen(false)} data-studio="desk" aria-current={location === '/settings' ? 'page' : undefined} className="studio-tab">Settings</Link>
          </nav>
        </SheetContent>
      </Sheet>
      <CommandPalette open={searchOpen} onOpenChange={setSearchOpen} userId={user.id} />
      <main
        id="main"
        tabIndex={-1}
        className={location === '/carousel' ? 'app-main w-full min-w-0 outline-none' : 'app-main mx-auto w-full min-w-0 max-w-[1440px] px-4 py-6 outline-none md:px-8 md:py-10'}
      >
        {children}
      </main>
    </div>
  );
}
