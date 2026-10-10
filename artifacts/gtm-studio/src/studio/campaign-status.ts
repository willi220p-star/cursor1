import type { CampaignEvent, CampaignEventKind, Contact, SavedCampaign, StudioConfig } from './types';

/**
 * Campaign workflow state that lives in the campaign's config jsonb (no extra columns):
 * a short run history, the status it implies, and the agency client tag.
 */

export const HISTORY_LIMIT = 50;

/** Events that set the campaign's status. A clean-up ('cleaned') is recorded but leaves the status alone. */
type StatusEventKind = Exclude<CampaignEventKind, 'cleaned'>;

export type CampaignStatus = 'draft' | StatusEventKind;

export const statusLabels: Record<CampaignStatus, string> = {
  draft: 'Draft',
  generated: 'Generated',
  uploaded: 'Uploaded',
  exported: 'Exported',
};

const eventKinds: CampaignEventKind[] = ['generated', 'uploaded', 'exported', 'cleaned'];

const isStatusEvent = (event: CampaignEvent): event is CampaignEvent & { kind: StatusEventKind } => event.kind !== 'cleaned';

function isEvent(value: unknown): value is CampaignEvent {
  if (!value || typeof value !== 'object') return false;
  const event = value as Partial<CampaignEvent>;
  return typeof event.at === 'string' && eventKinds.includes(event.kind as CampaignEventKind);
}

/** The stored history, cleaned of anything malformed (old saves, hand edits). */
export function campaignHistory(config: Pick<StudioConfig, 'history'> | null | undefined): CampaignEvent[] {
  const raw = config?.history;
  return Array.isArray(raw) ? raw.filter(isEvent) : [];
}

/** Adds one event and keeps the newest HISTORY_LIMIT, oldest first. Never mutates the input. */
export function pushHistory(
  history: CampaignEvent[] | undefined,
  event: { kind: CampaignEventKind; rows: number; at?: string },
  limit = HISTORY_LIMIT,
): CampaignEvent[] {
  const next: CampaignEvent = {
    at: event.at ?? new Date().toISOString(),
    kind: event.kind,
    rows: Math.max(0, Math.round(Number(event.rows) || 0)),
  };
  return [...campaignHistory({ history }), next].slice(-Math.max(1, limit));
}

/**
 * Draft until something happens; after that the latest status event wins (by time, then by order).
 * A clean-up event is skipped, so cleaning old files never changes what the campaign shows.
 */
export function campaignStatus(config: Pick<StudioConfig, 'history'> | null | undefined): CampaignStatus {
  const history = campaignHistory(config);
  let latest: (CampaignEvent & { kind: StatusEventKind }) | null = null;
  let latestTime = -Infinity;
  for (const event of history) {
    if (!isStatusEvent(event)) continue;
    const time = Date.parse(event.at);
    const value = Number.isFinite(time) ? time : -Infinity;
    if (value >= latestTime) {
      latest = event;
      latestTime = value;
    }
  }
  return latest?.kind ?? 'draft';
}

function shortStamp(at: string) {
  const date = new Date(at);
  if (!Number.isFinite(date.getTime())) return '';
  const day = date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  const time = date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });
  return `${day} ${time}`;
}

/** "Generated 24 rows · 9 Oct 14:02"; a clean-up reads "Cleaned up 37 old files · 9 Oct 15:10". */
export function formatHistoryEntry(event: CampaignEvent) {
  const stamp = shortStamp(event.at);
  const what = isStatusEvent(event)
    ? `${statusLabels[event.kind]} ${event.rows} ${event.rows === 1 ? 'row' : 'rows'}`
    : `Cleaned up ${event.rows} old ${event.rows === 1 ? 'file' : 'files'}`;
  return `${what}${stamp ? ` · ${stamp}` : ''}`;
}

/** Newest first, for menus and tooltips. */
export function recentHistory(config: Pick<StudioConfig, 'history'> | null | undefined, count = 5) {
  return campaignHistory(config).slice(-count).reverse();
}

export function cleanClient(value: string | undefined | null) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, 80);
}

export function campaignClient(campaign: Pick<SavedCampaign, 'config'>) {
  return cleanClient(campaign.config?.client);
}

/** Every client used so far, case-insensitively unique, sorted for suggestions and filters. */
export function knownClients(campaigns: Array<Pick<SavedCampaign, 'config'>>) {
  const byKey = new Map<string, string>();
  for (const campaign of campaigns) {
    const client = campaignClient(campaign);
    if (client && !byKey.has(client.toLowerCase())) byKey.set(client.toLowerCase(), client);
  }
  return [...byKey.values()].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
}

const COMPANY_KEY = /^(company|company_name|companyname|organi[sz]ation|organi[sz]ation_name|org|business|employer|account|account_name)$/i;

/**
 * Lower-cased text a search can match for a campaign: name, client and the company values in its
 * list. Work is capped (rows and characters) so a 5,000-row campaign does not stall typing.
 */
export function campaignSearchText(
  campaign: Pick<SavedCampaign, 'name' | 'config' | 'contacts'>,
  { maxRows = 300, maxChars = 4000 }: { maxRows?: number; maxChars?: number } = {},
) {
  const parts = [campaign.name, campaignClient(campaign)];
  const seen = new Set<string>();
  let length = 0;
  const rows: Contact[] = Array.isArray(campaign.contacts) ? campaign.contacts.slice(0, maxRows) : [];
  let companyKeys: string[] | null = null;
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    if (!companyKeys) companyKeys = Object.keys(row).filter((key) => COMPANY_KEY.test(key.trim().replace(/\s+/g, '_')));
    if (!companyKeys.length) break;
    for (const key of companyKeys) {
      const value = String(row[key] ?? '').trim();
      if (!value || value.startsWith('data:')) continue;
      const lower = value.toLowerCase();
      if (seen.has(lower)) continue;
      seen.add(lower);
      parts.push(value);
      length += value.length + 1;
    }
    if (length >= maxChars) break;
  }
  return parts.filter(Boolean).join(' ').toLowerCase().slice(0, maxChars + 400);
}
