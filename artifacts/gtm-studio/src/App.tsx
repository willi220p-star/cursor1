import { lazy, Suspense, useEffect, useState, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { User } from '@supabase/supabase-js';
import {
  Redirect,
  Route,
  Router as WouterRouter,
  Switch,
  useLocation,
} from 'wouter';
import { toast } from 'sonner';
import { ErrorBoundary } from '@/components/error-boundary';
import { ResultsHost } from '@/components/results-panel';
import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import { LoginPage } from '@/pages/login';
import { DeskPage } from '@/pages/desk';
import { Shell } from '@/app/shell';
import { useTheme } from '@/lib/theme';
import { getCurrentSession, onAuthChange } from '@/studio/auth';
import { AccessProvider, canSeeActivity, canUseStudios, useAccess } from '@/studio/access-context';

// The studios, carousel and settings load on first visit so the Desk and sign-in paint fast.
const StudioGenerator = lazy(() => import('@/components/studio-generator').then((m) => ({ default: m.StudioGenerator })));
const CarouselGeneratorPage = lazy(() => import('@/carousel/page').then((m) => ({ default: m.CarouselGeneratorPage })));
const SettingsPage = lazy(() => import('@/pages/settings').then((m) => ({ default: m.SettingsPage })));
const MembersPage = lazy(() => import('@/pages/members').then((m) => ({ default: m.MembersPage })));
const ReviewPage = lazy(() => import('@/pages/review').then((m) => ({ default: m.ReviewPage })));
const ActivityPage = lazy(() => import('@/pages/activity').then((m) => ({ default: m.ActivityPage })));

const queryClient = new QueryClient();

function BootScreen() {
  return (
    <div className="login-shell is-boot">
      <div className="text-center" role="status" aria-live="polite">
        <p className="brand-lockup justify-center"><span className="brand-mark">DGK</span><span className="brand-name">Outbound Studio</span></p>
        <p className="display mt-4 text-2xl font-semibold">Checking access…</p>
      </div>
    </div>
  );
}

/** Shown in the page area while a studio's code loads; the shell and navigation stay put. */
function PageFallback() {
  return (
    <div className="grid min-h-[60dvh] place-items-center" role="status" aria-live="polite">
      <p className="text-sm text-muted-foreground">Opening…</p>
    </div>
  );
}

/** Sends the user back to the Desk with a toast when their role does not allow this page. */
function NotAllowed({ message }: { message: string }) {
  const [, navigate] = useLocation();
  useEffect(() => {
    toast.error('Not available for your role', { description: message });
    navigate('/', { replace: true });
  }, [message, navigate]);
  return null;
}

function Guard({ allow, message, children }: { allow: boolean; message: string; children: ReactNode }) {
  return allow ? <>{children}</> : <NotAllowed message={message} />;
}

const STUDIO_DENIED = 'Your role can view, download and review files, but not make new ones.';

function SignedInRoutes({ user }: { user: User }) {
  const access = useAccess();
  const userId = user.id;
  const email = user.email ?? undefined;
  const studiosOpen = canUseStudios(access);
  const canEditTemplates = access.can('template.edit', null);
  const studio = (mode: 'handwritten' | 'avatar' | 'memes' | 'gif' | 'handgif') => (
    <Guard allow={studiosOpen} message={STUDIO_DENIED}>
      <StudioGenerator key={mode} mode={mode} userId={userId} canEditTemplates={canEditTemplates} />
    </Guard>
  );
  return (
    <Shell user={user}>
      <Suspense fallback={<PageFallback />}>
        <Switch>
          <Route path="/"><DeskPage userId={userId} email={email} /></Route>
          <Route path="/handwritten">{studio('handwritten')}</Route>
          <Route path="/avatar">{studio('avatar')}</Route>
          <Route path="/memes">{studio('memes')}</Route>
          <Route path="/gif">{studio('gif')}</Route>
          <Route path="/handgif">{studio('handgif')}</Route>
          <Route path="/carousel"><Guard allow={studiosOpen} message={STUDIO_DENIED}><CarouselGeneratorPage userId={userId} /></Guard></Route>
          <Route path="/review/:id">{(params) => <ReviewPage campaignId={params.id} />}</Route>
          <Route path="/settings"><SettingsPage userId={userId} email={email} /></Route>
          <Route path="/members">
            <Guard allow={access.can('members.manage', null)} message="Only DGK staff manage members and spaces."><MembersPage userId={userId} /></Guard>
          </Route>
          <Route path="/activity">
            <Guard allow={canSeeActivity(access)} message="Activity is for DGK staff and Client Managers."><ActivityPage /></Guard>
          </Route>
          <Route><NotFound /></Route>
        </Switch>
      </Suspense>
    </Shell>
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

  return (
    <Switch>
      <Route path="/login"><Redirect to="/" replace /></Route>
      <Route>
        <AccessProvider user={user}>
          <SignedInRoutes user={user} />
        </AccessProvider>
      </Route>
    </Switch>
  );
}

export default function App() {
  const { resolved } = useTheme();
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider delayDuration={300}>
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
            <Router />
            <ResultsHost />
          </WouterRouter>
          <Toaster
            theme={resolved}
            position="bottom-right"
            duration={5000}
            visibleToasts={3}
            closeButton
            offset={20}
            mobileOffset={{ bottom: 88 }}
            toastOptions={{
              classNames: {
                toast: 'group toast !rounded-[16px] !border-border !bg-popover !text-foreground !shadow-[var(--shadow-overlay)] !text-sm',
                title: '!text-sm !font-semibold',
                description: '!text-sm !text-muted-foreground',
                actionButton: '!min-h-10 !rounded-full !bg-primary !px-4 !text-sm !font-semibold !text-primary-foreground',
                cancelButton: '!min-h-10 !rounded-full !bg-fill !px-4 !text-sm !text-foreground',
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
