import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { User } from '@supabase/supabase-js';
import {
  ArrowRight,
  ArrowUpDown,
  CircleUser,
  Cloud,
  Database,
  Film,
  Gauge,
  Image,
  LayoutGrid,
  LogOut,
  Menu,
  Pencil,
  PenLine,
  Settings2,
  ShieldCheck,
  UploadCloud,
} from 'lucide-react';
import {
  Link,
  Redirect,
  Route,
  Router as WouterRouter,
  Switch,
  useLocation,
} from 'wouter';
import { ErrorBoundary } from '@/components/error-boundary';
import { Badge } from '@/components/ui/badge';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import { Toaster } from '@/components/ui/sonner';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import { LoginPage } from '@/pages/login';
import { StudioGenerator } from '@/components/studio-generator';
import { CarouselGeneratorPage } from '@/carousel/page';
import { exportsInLast30Days, relativeTime, requestSampleList } from '@/studio/activity';
import { getCurrentSession, onAuthChange, signOutUser } from '@/studio/auth';
import { listCampaigns, listTemplateConfigs, supabaseConfigured, subscribeTemplateChanges } from '@/studio/cloud';
import type { SavedCampaign, SavedTemplate, StudioMode } from '@/studio/types';

const queryClient = new QueryClient();

const nav = [
  { href: '/', label: 'Desk', icon: Gauge },
  { href: '/handwritten', label: 'Notes', icon: PenLine },
  { href: '/avatar', label: 'Avatar', icon: CircleUser },
  { href: '/memes', label: 'Memes', icon: Image },
  { href: '/gif', label: 'GIFs', icon: Film },
  { href: '/handgif', label: 'Write', icon: Pencil },
  { href: '/carousel', label: 'Carousel', icon: LayoutGrid },
];

const pageTitles: Record<string, string> = {
  '/': 'Desk',
  '/handwritten': 'Handwritten notes',
  '/avatar': 'Avatar cards',
  '/memes': 'Moving memes',
  '/gif': 'Animated GIFs',
  '/handgif': 'Handwriting GIF',
  '/carousel': 'Carousel generator',
  '/settings': 'Settings',
};

/** Views that render their own `<h1>` get a plain title in the top bar. */
const ownHeading = new Set(['/', '/handwritten', '/avatar', '/memes', '/gif', '/handgif', '/carousel', '/settings']);

function modeHref(mode: StudioMode) {
  return `/${mode}`;
}

function modeLabel(mode: StudioMode) {
  if (mode === 'handwritten') return 'Handwritten notes';
  if (mode === 'handgif') return 'Handwriting GIF';
  if (mode === 'memes') return 'Moving memes';
  if (mode === 'avatar') return 'Avatar cards';
  return 'Animated GIFs';
}

function ModeIcon({ mode, size = 20 }: { mode: StudioMode; size?: number }) {
  if (mode === 'handwritten') return <PenLine size={size} aria-hidden />;
  if (mode === 'handgif') return <Pencil size={size} aria-hidden />;
  if (mode === 'avatar') return <CircleUser size={size} aria-hidden />;
  if (mode === 'memes') return <Image size={size} aria-hidden />;
  return <Film size={size} aria-hidden />;
}

function LogoMark({ wordmark = false }: { wordmark?: boolean }) {
  return (
    <Link href="/" aria-label="Outbound Studio home" className={wordmark ? 'rail-brand' : 'logo-mark'}>
      <span className="logo-glyph">
        <PenLine size={18} strokeWidth={2.25} aria-hidden />
      </span>
      {wordmark && (
        <span className="rail-brand-copy">
          <span className="rail-kicker">DGK</span>
          <span className="display">Outbound</span>
        </span>
      )}
    </Link>
  );
}

function RailNav({ location, onNavigate, email }: { location: string; onNavigate?: () => void; email: string }) {
  const initials = email.slice(0, 2).toUpperCase();
  return (
    <>
      <nav className="mt-6 flex flex-1 flex-col gap-1" aria-label="Primary">
        {nav.map((item) => {
          const active = location === item.href;
          const Icon = item.icon;
          return (
            <Link key={item.href} href={item.href} onClick={onNavigate} aria-current={active ? 'page' : undefined} className={`icon-link ${active ? 'is-active' : ''}`}>
              <Icon size={24} strokeWidth={1.75} aria-hidden />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>
      <div className="flex flex-col gap-1">
        <Link href="/settings" onClick={onNavigate} aria-current={location === '/settings' ? 'page' : undefined} className={`icon-link ${location === '/settings' ? 'is-active' : ''}`}>
          <Settings2 size={24} strokeWidth={1.75} aria-hidden />
          <span>Settings</span>
        </Link>
        <Tooltip>
          <TooltipTrigger asChild>
            <button type="button" className="icon-link" aria-label={`Sign out ${email}`} onClick={() => void signOutUser()}>
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-rail-foreground text-xs font-bold text-rail">{initials}</span>
              <span>Sign out</span>
            </button>
          </TooltipTrigger>
          <TooltipContent side="right">Sign out {email}</TooltipContent>
        </Tooltip>
      </div>
    </>
  );
}

function Shell({ children, user }: { children: ReactNode; user: User }) {
  const [location] = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const email = user.email ?? 'Operator';
  const title = pageTitles[location] ?? 'Not found';
  const TitleTag = ownHeading.has(location) ? 'p' : 'h1';
  return (
    <div className="shell-frame">
      <a href="#main" className="skip-link">Skip to content</a>
      <aside className="studio-rail icon-rail fixed inset-y-0 left-0 z-40 hidden flex-col md:flex" aria-label="Sidebar">
        <LogoMark wordmark />
        <RailNav location={location} email={email} />
      </aside>
      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent side="left" className="studio-rail w-[280px] border-rail-muted/20 p-4 sm:max-w-[280px] [&>button]:h-11 [&>button]:w-11 [&>button]:text-rail-foreground [&>button]:opacity-100 [&>button>svg]:mx-auto [&>button>svg]:h-5 [&>button>svg]:w-5">
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          <SheetDescription className="sr-only">Move between the desk and the studios.</SheetDescription>
          <div className="flex h-full flex-col">
            <div className="flex items-center gap-3 px-1">
              <LogoMark />
              <span className="display text-lg text-rail-foreground">Outbound Studio</span>
            </div>
            <RailNav location={location} email={email} onNavigate={() => setMobileOpen(false)} />
          </div>
        </SheetContent>
      </Sheet>
      <div className="min-w-0 md:pl-[232px]">
        <header className="topbar px-4 md:px-8">
          <div className="flex min-w-0 items-center gap-3">
            <button type="button" aria-label="Open navigation" className="btn btn-ghost btn-icon h-11 w-11 md:hidden" onClick={() => setMobileOpen(true)}><Menu size={20} aria-hidden /></button>
            <div className="flex min-w-0 items-baseline gap-2">
              <span className="hidden text-sm text-muted-foreground sm:inline">DGK · Darwin /</span>
              <TitleTag className="display truncate text-xl font-semibold">{title}</TitleTag>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="status-chip inline-flex" role="status">
              <span className={`dot ${supabaseConfigured ? 'is-live' : 'is-local'}`} aria-hidden />
              <span className="status-chip-text">{supabaseConfigured ? 'Live sync' : 'Local only'}</span>
            </span>
            <button type="button" className="btn btn-ghost" onClick={() => void signOutUser()}>
              <LogOut size={16} aria-hidden /> <span className="hidden sm:inline">Sign out</span><span className="sr-only sm:hidden">Sign out</span>
            </button>
          </div>
        </header>
        <main id="main" tabIndex={-1} className={location === '/carousel' ? 'app-main w-full min-w-0 outline-none' : 'app-main mx-auto w-full min-w-0 max-w-[1440px] px-4 py-6 outline-none md:px-8 md:py-8'}>{children}</main>
      </div>
    </div>
  );
}

function StudioCard({ mode, description }: { mode: StudioMode; description: string }) {
  return (
    <Link href={modeHref(mode)} className="studio-card">
      <span className="icon-disc"><ModeIcon mode={mode} /></span>
      <span className="block">
        <strong className="block text-lg font-semibold">{modeLabel(mode)}</strong>
        <span className="mt-1 block text-sm leading-relaxed text-muted-foreground">{description}</span>
      </span>
      <span className="mt-auto inline-flex items-center gap-1 text-sm font-semibold text-primary">Open <ArrowRight size={16} aria-hidden /></span>
    </Link>
  );
}

function DeskPage({ userId, email }: { userId?: string; email?: string }) {
  const [, navigate] = useLocation();
  const scope = userId ?? 'anonymous';
  const [campaigns, setCampaigns] = useState<SavedCampaign[] | null>(null);
  const [templates, setTemplates] = useState<SavedTemplate[]>([]);
  const [sortDesc, setSortDesc] = useState(true);
  useEffect(() => {
    listCampaigns(userId).then(setCampaigns).catch(() => setCampaigns([]));
    listTemplateConfigs(userId).then(setTemplates).catch(() => setTemplates([]));
    return subscribeTemplateChanges(userId, () => {
      listTemplateConfigs(userId).then(setTemplates).catch(() => setTemplates([]));
    });
  }, [userId]);
  const openCampaign = (campaign: SavedCampaign) => {
    localStorage.setItem(`gtm-studio-load-campaign:${scope}`, JSON.stringify(campaign));
    navigate(modeHref(campaign.mode));
  };
  const openTemplate = (template: SavedTemplate) => {
    localStorage.setItem(`gtm-studio-load-template:${scope}`, JSON.stringify(template));
    navigate(modeHref(template.mode));
  };
  const loadSample = () => {
    requestSampleList(scope);
    navigate('/handwritten');
  };
  const firstName = (email?.split('@')[0]?.split('.')[0] ?? 'operator').replace(/^\w/, (c) => c.toUpperCase());
  const list = campaigns ?? [];
  const contactCount = list.reduce((sum, campaign) => sum + (campaign.contacts?.length ?? 0), 0);
  const lastSave = list.reduce<string | null>((latest, campaign) => (!latest || campaign.updatedAt > latest ? campaign.updatedAt : latest), null);
  const exported = exportsInLast30Days(scope);
  const sorted = useMemo(
    () => [...list].sort((a, b) => (sortDesc ? b.updatedAt.localeCompare(a.updatedAt) : a.updatedAt.localeCompare(b.updatedAt))),
    [list, sortDesc],
  );
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  return (
    <div className="animate-rise">
      <header className="desk-hero flex flex-col gap-2">
        <p className="eyebrow">DGK Outbound Studio</p>
        <h1 className="display font-semibold leading-[1.08]">{greeting}, {firstName}</h1>
        <p className="text-base text-muted-foreground">
          {campaigns === null
            ? 'Loading your ledger…'
            : `${list.length} saved ${list.length === 1 ? 'campaign' : 'campaigns'} · ${contactCount} prospect rows · last save ${relativeTime(lastSave)}`}
        </p>
      </header>

      <section aria-labelledby="studios-heading" className="mt-8">
        <h2 id="studios-heading" className="display mb-4 text-2xl font-semibold">Studios</h2>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <StudioCard mode="handwritten" description="Paper, ink slips, ruled lines and a signature that reads as written, not typed." />
          <StudioCard mode="handgif" description="A separate writing GIF — a hand writes the note, then you download the loop." />
          <StudioCard mode="avatar" description="Portrait stays on the page. The letter types like Canva. Download this row is a GIF." />
          <StudioCard mode="memes" description="Copyright-safe templates — two buttons, table sign, expanding boxes, and more. Style each text box and export a live GIF." />
          <StudioCard mode="gif" description="Worker-encoded loops with fade, slide or flip for every prospect row." />
          <Link href="/carousel" className="studio-card">
            <span className="icon-disc"><LayoutGrid size={20} aria-hidden /></span>
            <span className="block">
              <strong className="block text-lg font-semibold">Carousel generator</strong>
              <span className="mt-1 block text-sm leading-relaxed text-muted-foreground">LinkedIn carousel maker — slides, themes, fonts, export PDF. Separate from notes, avatar, memes and GIFs.</span>
            </span>
            <span className="mt-auto inline-flex items-center gap-1 text-sm font-semibold text-primary">Open <ArrowRight size={16} aria-hidden /></span>
          </Link>
        </div>
      </section>

      <section aria-labelledby="stats-heading" className="mt-8">
        <h2 id="stats-heading" className="sr-only">Workspace numbers</h2>
        <div className="stat-board">
          <div className="dash-stat"><span>Saved campaigns</span><strong>{list.length}</strong><small>{supabaseConfigured ? 'Cloud and this browser' : 'This browser'}</small></div>
          <div className="dash-stat"><span>Prospect rows</span><strong>{contactCount}</strong><small>Across saved campaigns</small></div>
          <div className="dash-stat"><span>Assets exported (30 d)</span><strong>{exported}</strong><small>Rows and ZIPs from this browser</small></div>
          <div className="dash-stat"><span>Last save</span><strong>{relativeTime(lastSave)}</strong><small>{lastSave ? new Date(lastSave).toLocaleString() : 'Nothing saved yet'}</small></div>
        </div>
      </section>

      {templates.length > 0 && (
        <section aria-labelledby="templates-heading" className="mt-10">
          <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="eyebrow">Templates</p>
              <h2 id="templates-heading" className="display mt-1 text-2xl font-semibold">Reuse a studio look</h2>
            </div>
            <span className="mono text-sm text-muted-foreground">{templates.length} saved · edits in Supabase show here</span>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {templates.slice(0, 8).map((template) => (
              <button key={template.id} type="button" className="panel w-full min-w-0 p-4 text-left transition-colors hover:border-input" onClick={() => openTemplate(template)}>
                <span className="flex items-center gap-3">
                  <span className="icon-disc"><ModeIcon mode={template.mode} size={16} /></span>
                  <span className="min-w-0">
                    <strong className="block truncate">{template.name}</strong>
                    <small className="block text-muted-foreground">{modeLabel(template.mode)} · {template.cloud ? 'Supabase' : 'This browser'}</small>
                  </span>
                </span>
              </button>
            ))}
          </div>
        </section>
      )}

      <section aria-labelledby="ledger-heading" className="mt-10">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="eyebrow">Ledger</p>
            <h2 id="ledger-heading" className="display mt-1 text-2xl font-semibold">Resume recent work</h2>
          </div>
          <span className="mono text-sm text-muted-foreground">{list.length} saved</span>
        </div>
        <div className="ledger">
          {campaigns === null ? (
            <div className="space-y-3 p-4" aria-busy="true" aria-label="Loading campaigns">
              {[0, 1, 2].map((i) => <div key={i} className="h-11 animate-pulse rounded-md bg-surface-2" />)}
            </div>
          ) : sorted.length ? (
            <div className="overflow-x-auto">
              <table>
                <thead>
                  <tr>
                    <th scope="col">Name</th>
                    <th scope="col" className="mobile-hide">Studio</th>
                    <th scope="col" className="num">Rows</th>
                    <th scope="col" aria-sort={sortDesc ? 'descending' : 'ascending'}>
                      <button type="button" className="inline-flex h-11 items-center gap-1 uppercase tracking-[.06em]" onClick={() => setSortDesc((value) => !value)}>
                        Updated <ArrowUpDown size={14} aria-hidden />
                      </button>
                    </th>
                    <th scope="col" className="mobile-hide">Where</th>
                    <th scope="col"><span className="sr-only">Open</span></th>
                  </tr>
                </thead>
                <tbody>
                  {sorted.slice(0, 12).map((campaign) => (
                    <tr key={campaign.id} onClick={() => openCampaign(campaign)}>
                      <td>
                        <span className="flex items-center gap-3">
                          <span className="icon-disc"><ModeIcon mode={campaign.mode} size={16} /></span>
                          <span className="truncate font-semibold">{campaign.name}</span>
                        </span>
                      </td>
                      <td className="mobile-hide text-muted-foreground">{modeLabel(campaign.mode)}</td>
                      <td className="num">{campaign.contacts?.length ?? 0}</td>
                      <td className="text-muted-foreground" title={new Date(campaign.updatedAt).toLocaleString()}>{relativeTime(campaign.updatedAt)}</td>
                      <td className="mobile-hide">
                        <Badge variant="outline" className="gap-1 font-medium">{campaign.cloud ? <Cloud size={14} aria-hidden /> : <Database size={14} aria-hidden />}{campaign.cloud ? 'Cloud' : 'Local'}</Badge>
                      </td>
                      <td className="text-right">
                        <button type="button" className="btn btn-ghost btn-sm" onClick={(event) => { event.stopPropagation(); openCampaign(campaign); }}>Open <ArrowRight size={16} aria-hidden /></button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="empty-state">
              <Database size={24} className="text-muted-foreground" aria-hidden />
              <h3>No campaigns yet</h3>
              <p>Import a list from any studio and press Save. Your first save appears here.</p>
              <div className="mt-4 flex flex-wrap justify-center gap-2">
                <Link href="/handwritten" className="btn btn-primary">Start with Notes</Link>
                <button type="button" className="btn btn-quiet" onClick={loadSample}>Load sample list</button>
              </div>
              <ol className="process-strip mt-8 w-full max-w-[880px] text-left">
                <li><span>01</span> Drop a list on the desk</li>
                <li><span>02</span> Write once with merge tags</li>
                <li><span>03</span> Tune ink, paper or motion</li>
                <li><span>04</span> Download this row or the ZIP</li>
              </ol>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

function SettingsPage({ email }: { userId?: string; email?: string }) {
  return (
    <div className="mx-auto max-w-[960px] animate-rise">
      <p className="eyebrow">Workspace configuration</p>
      <h1 className="display mt-2 text-[32px] font-semibold leading-[1.15]">Access, storage and hand-off</h1>
      <div className="mt-8 grid gap-4 md:grid-cols-2">
        <div className="panel p-6">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-lg font-semibold">Authentication</h3>
            <Badge variant="outline" className="gap-1 font-medium"><ShieldCheck size={14} aria-hidden /> Invite only</Badge>
          </div>
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
            Sign in with an invited operator account. Add or remove people in the Supabase project
            {' '}<strong className="text-foreground">DGK GTM Personalisation</strong>: Authentication → Users → Invite / Add user.
            Keep “Allow new users to sign up” off.
          </p>
          <div className="mt-5 rounded-md bg-surface-2 p-4 text-sm leading-relaxed">
            <strong>This workspace login</strong>
            <span className="mt-1 block text-muted-foreground">Signed in now as {email ?? '—'}</span>
            <a className="mt-2 inline-flex min-h-10 items-center font-semibold text-primary underline-offset-4 hover:underline" href="https://supabase.com/dashboard/project/hvvtmhlxdmeyozyirpqo/auth/users" target="_blank" rel="noreferrer">Open Supabase users</a>
          </div>
          <button type="button" className="btn btn-quiet mt-4" onClick={() => void signOutUser()}><LogOut size={16} aria-hidden /> Sign out</button>
        </div>
        <div className="panel p-6">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-lg font-semibold">Airtable hand-off</h3>
            <UploadCloud size={20} className="text-muted-foreground" aria-hidden />
          </div>
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">Every ZIP contains a manifest with <code className="mono text-sm">image_url</code> and <code className="mono text-sm">smartlead_image_url</code>. Cloud uploads populate those URLs before export.</p>
          <p className="mt-5 inline-flex items-center gap-2 text-sm font-medium text-muted-foreground"><ShieldCheck size={16} aria-hidden /> Integration preserved</p>
        </div>
        <div className="panel p-6 md:col-span-2">
          <h3 className="text-lg font-semibold">Do you need a paid Supabase plan?</h3>
          <p className="mt-3 max-w-[70ch] text-sm leading-relaxed text-muted-foreground">
            No. The free Supabase project is enough for operator login, a handful of authorised users, and campaign saves.
            Upgrade later only if you need more than the free auth/storage quotas. Public signup stays off either way.
          </p>
          <div className="mt-4 grid gap-4 text-sm leading-relaxed text-muted-foreground md:grid-cols-3">
            <div><strong className="block text-foreground">Browser rendering</strong>Prospect files and canvas rendering stay in the browser.</div>
            <div><strong className="block text-foreground">Explicit upload</strong>Nothing reaches Supabase until you choose Cloud after review.</div>
            <div><strong className="block text-foreground">Invite operators</strong>Authentication → Users → Invite. Do not enable public signup.</div>
          </div>
        </div>
      </div>
    </div>
  );
}

function BootScreen() {
  return (
    <div className="login-shell">
      <div className="text-center" role="status" aria-live="polite">
        <p className="eyebrow">DGK Outbound Studio</p>
        <p className="display mt-3 text-2xl font-semibold">Checking access…</p>
      </div>
    </div>
  );
}

function Router() {
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [bootError, setBootError] = useState<string | null>(null);

  useEffect(() => {
    getCurrentSession().then(({ data, error }) => {
      if (error && !data) setBootError(error);
      setUser(data?.user ?? null);
    });
    return onAuthChange((next) => setUser(next));
  }, []);

  if (user === undefined) return <BootScreen />;
  if (!user) return <LoginPage bootError={bootError} />;

  const userId = user.id;
  const email = user.email ?? undefined;
  return (
    <Switch>
      <Route path="/login"><Redirect to="/" replace /></Route>
      <Route>
        <Shell user={user}>
          <Switch>
            <Route path="/"><DeskPage userId={userId} email={email} /></Route>
            <Route path="/handwritten"><StudioGenerator key="handwritten" mode="handwritten" userId={userId} /></Route>
            <Route path="/avatar"><StudioGenerator key="avatar" mode="avatar" userId={userId} /></Route>
            <Route path="/memes"><StudioGenerator key="memes" mode="memes" userId={userId} /></Route>
            <Route path="/gif"><StudioGenerator key="gif" mode="gif" userId={userId} /></Route>
            <Route path="/handgif"><StudioGenerator key="handgif" mode="handgif" userId={userId} /></Route>
            <Route path="/carousel"><CarouselGeneratorPage /></Route>
            <Route path="/settings"><SettingsPage userId={userId} email={email} /></Route>
            <Route><NotFound /></Route>
          </Switch>
        </Shell>
      </Route>
    </Switch>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider delayDuration={300}>
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
            <Router />
          </WouterRouter>
          <Toaster
            theme="light"
            position="bottom-right"
            duration={5000}
            visibleToasts={3}
            closeButton
            offset={20}
            mobileOffset={{ bottom: 88 }}
            toastOptions={{
              classNames: {
                toast: 'group toast !rounded-[12px] !border-border !bg-card !text-foreground !shadow-[var(--shadow-overlay)] !text-sm',
                title: '!text-sm !font-semibold',
                description: '!text-sm !text-muted-foreground',
                actionButton: '!min-h-10 !rounded-[6px] !bg-primary !px-3 !text-sm !font-semibold !text-primary-foreground',
                cancelButton: '!min-h-10 !rounded-[6px] !bg-surface-2 !px-3 !text-sm !text-foreground',
                closeButton: '!h-10 !w-10 !border-border !bg-card !text-foreground [@media(pointer:coarse)]:!h-11 [@media(pointer:coarse)]:!w-11',
                success: '[&_[data-icon]]:!text-success',
                error: '[&_[data-icon]]:!text-destructive',
              },
            }}
          />
        </TooltipProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}
