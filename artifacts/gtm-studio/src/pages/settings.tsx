import { LogOut, ShieldCheck, UploadCloud } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { useTheme, type ThemePreference } from '@/lib/theme';
import { signOutUser } from '@/studio/auth';
import { Link } from 'wouter';
import { clientRole, clientSpaceId, isStaff, orgRoleLabels, spaceRoleLabels } from '@/studio/access';
import { spaceName, useAccess } from '@/studio/access-context';

const themeOptions: Array<{ value: ThemePreference; label: string }> = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'system', label: 'Match device' },
];

export function SettingsPage({ email }: { userId?: string; email?: string }) {
  const { preference, setPreference } = useTheme();
  const access = useAccess();
  const staff = isStaff(access.orgRole);
  const memberRole = clientRole(access.memberships);
  const roleLabel = !staff && memberRole ? spaceRoleLabels[memberRole] : orgRoleLabels[access.orgRole];
  const ownSpace = staff ? '' : spaceName(access.spaces, clientSpaceId(access.memberships, access.spaces));
  return (
    <div className="mx-auto max-w-[960px] animate-rise">
      <h1 className="display text-[clamp(36px,4.4vw,52px)] font-semibold leading-[1.05]">Settings</h1>
      <p className="mt-3 max-w-[60ch] text-base text-muted-foreground">Access, appearance, and where your files go.</p>
      <div className="mt-10 grid gap-4 md:grid-cols-2">
        <div className="panel p-6 md:col-span-2">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold">Appearance</h2>
              <p className="mt-1 text-sm text-muted-foreground">Choose light or dark, or follow this device. Saved on this device only.</p>
            </div>
            <div className="segmented" role="group" aria-label="Theme">
              {themeOptions.map((option) => (
                <button key={option.value} type="button" aria-pressed={preference === option.value} onClick={() => setPreference(option.value)}>
                  {option.label}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="panel p-6">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-semibold">Authentication</h2>
            <Badge variant="outline" className="gap-1 rounded-full font-medium"><ShieldCheck size={14} aria-hidden /> Invite only</Badge>
          </div>
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
            {access.can('members.manage', null)
              ? 'People join by invite only. Invite team members and clients, change roles and manage client spaces on the Members page.'
              : 'People join by invite only. Ask DGK if you need someone else added or your role changed.'}
          </p>
          <div className="mt-5 rounded-[14px] bg-surface-2 p-4 text-sm leading-relaxed">
            <strong>This workspace login</strong>
            <span className="mt-1 block text-muted-foreground">Signed in now as {email ?? 'an operator'}</span>
            <span className="mt-1 block text-muted-foreground" data-testid="settings-role">{roleLabel}{ownSpace ? ` · ${ownSpace}` : ''}</span>
            {access.can('members.manage', null) && (
              <Link className="mt-2 inline-flex min-h-10 items-center font-semibold text-primary underline-offset-4 hover:underline" href="/members">Open Members</Link>
            )}
          </div>
          <button type="button" className="btn btn-quiet mt-4" onClick={() => void signOutUser()}><LogOut size={16} aria-hidden /> Sign out</button>
        </div>
        <div className="panel p-6">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-semibold">Airtable hand-off</h2>
            <UploadCloud size={20} className="text-muted-foreground" aria-hidden />
          </div>
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">Every ZIP contains a manifest with <code className="mono text-sm">image_url</code> and <code className="mono text-sm">smartlead_image_url</code>. Cloud uploads fill those links before export.</p>
          <p className="mt-5 inline-flex items-center gap-2 text-sm font-medium text-muted-foreground"><ShieldCheck size={16} aria-hidden /> Integration preserved</p>
        </div>
        {staff && (
        <div className="panel p-6 md:col-span-2">
          <h2 className="text-lg font-semibold">Do you need a paid Supabase plan?</h2>
          <p className="mt-3 max-w-[70ch] text-sm leading-relaxed text-muted-foreground">
            No. The free Supabase project is enough for operator login, a handful of authorised users, and campaign saves.
            Upgrade later only if you need more than the free auth and storage quotas. Public signup stays off either way.
          </p>
          <div className="mt-4 grid gap-4 text-sm leading-relaxed text-muted-foreground md:grid-cols-3">
            <div><strong className="block text-foreground">Browser rendering</strong>Prospect files and canvas rendering stay in the browser.</div>
            <div><strong className="block text-foreground">Explicit upload</strong>Nothing reaches Supabase until you choose Cloud after review.</div>
            <div><strong className="block text-foreground">Invite people</strong>Members page → Invite someone. Public signup stays off.</div>
          </div>
        </div>
        )}
      </div>
    </div>
  );
}
