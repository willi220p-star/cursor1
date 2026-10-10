/**
 * Which portrait an avatar card shows for a row, and what it shows when the row has none.
 * Pure logic, no DOM: the renderer maps the chosen source through the portrait cache and draws it.
 *
 * The rule that keeps the wrong face off a card: the photo uploaded or linked in the Look tab is only
 * used for every row when no portrait column is chosen (one prospect, or one face for everyone).
 * With a portrait column chosen, a row with no portrait of its own gets a badge instead: the company's
 * site icon when a website is on the row and loads, else the prospect's initials on a colour picked
 * from their company, so the same company always gets the same colour.
 */
import { AVATAR_CACHE_FIELD, AVATAR_SOURCE_FIELD, looksLikeImageSource, type Contact, type StudioConfig } from './types';

/** Badge colours from the app palette (studio and status colours), all dark enough for white initials. */
export const AVATAR_BADGE_COLORS = ['#3859f9', '#c2410c', '#0f766e', '#be185d', '#b45309', '#2238b3', '#0d1117'] as const;

export type PortraitFrom = 'cache' | 'column' | 'stored' | 'global' | 'none';

type PortraitConfig = Pick<StudioConfig, 'avatarColumn' | 'avatarUrl' | 'avatarImage'>;

/** True when the list's portraits come from a column, so the global photo must not stand in for a row. */
export function portraitColumnInUse(config: Pick<StudioConfig, 'avatarColumn'>) {
  return Boolean(config.avatarColumn?.trim());
}

function cell(contact: Contact, key: string | undefined) {
  return key ? String(contact[key] ?? '').trim() : '';
}

/** The raw portrait source for a row (before the cache lookup), and where it came from. */
export function rowPortraitSource(config: PortraitConfig, contact: Contact): { source: string; from: PortraitFrom } {
  const cached = cell(contact, AVATAR_CACHE_FIELD);
  if (cached) return { source: cached, from: 'cache' };
  const fromColumn = cell(contact, config.avatarColumn);
  if (fromColumn) return { source: fromColumn, from: 'column' };
  const stored = cell(contact, AVATAR_SOURCE_FIELD);
  if (stored) return { source: stored, from: 'stored' };
  if (!portraitColumnInUse(config)) {
    const global = config.avatarUrl?.trim() || config.avatarImage?.trim() || '';
    if (global) return { source: global, from: 'global' };
  }
  return { source: '', from: 'none' };
}

/** Rows that will get a badge instead of a photo: no portrait, or a cell that is not an image link. */
export function rowsMissingPortrait(config: PortraitConfig, contacts: Contact[]) {
  return contacts.flatMap((contact, index) => {
    const { source, from } = rowPortraitSource(config, contact);
    const usable = from !== 'none' && (from === 'cache' || from === 'global' || source.startsWith('data:') || looksLikeImageSource(source));
    return usable ? [] : [{ index, row: Number(contact.row) || index + 1 }];
  });
}

function letters(word: string) {
  return Array.from(word.replace(/[^\p{L}\p{N}]/gu, ''));
}

/** Two initials: first and last name, else the full name split, else the company. Empty when none. */
export function initialsFor(contact: Contact) {
  const first = cell(contact, 'first_name') || cell(contact, 'firstname');
  const last = cell(contact, 'last_name') || cell(contact, 'lastname') || cell(contact, 'surname');
  const full = cell(contact, 'name') || cell(contact, 'full_name') || cell(contact, 'fullname');
  let words: string[];
  if (first && last) words = [first, last];
  else if (full) {
    const parts = full.split(/\s+/).filter((part) => letters(part).length);
    words = parts.length > 1 ? [parts[0], parts[parts.length - 1]] : parts;
    // "Maya" in name but a last name column: still use both.
    if (words.length === 1 && last) words.push(last);
  } else if (first) words = last ? [first, last] : [first];
  else words = cell(contact, 'company').split(/\s+/).filter((part) => letters(part).length).slice(0, 2);
  return words.map((word) => letters(word)[0] ?? '').join('').toUpperCase().slice(0, 2);
}

/** FNV-1a: a small, stable string hash. */
function hash(text: string) {
  let value = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    value ^= text.charCodeAt(i);
    value = Math.imul(value, 0x01000193);
  }
  return value >>> 0;
}

/** Badge colour from the company (so a whole account matches), else the name. */
export function badgeColorFor(contact: Contact) {
  const key = (cell(contact, 'company') || cell(contact, 'name') || cell(contact, 'full_name')
    || `${cell(contact, 'first_name')} ${cell(contact, 'last_name')}`.trim() || String(contact.row ?? '')).toLowerCase();
  return AVATAR_BADGE_COLORS[hash(key) % AVATAR_BADGE_COLORS.length];
}

const WEBSITE_KEYS = ['website', 'company_website', 'domain', 'company_domain', 'website_url', 'company_url'];

/** The company's host name from the row's website column, without "www.". Empty when there is none. */
export function companyHost(config: Pick<StudioConfig, 'websiteColumn'>, contact: Contact) {
  const raw = cell(contact, config.websiteColumn) || WEBSITE_KEYS.map((key) => cell(contact, key)).find(Boolean) || '';
  if (!raw || /\s/.test(raw) || raw.includes('@')) return '';
  try {
    const host = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`).hostname.toLowerCase().replace(/^www\./, '');
    return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host) ? host : '';
  } catch {
    return '';
  }
}

/** Site icon for the row's company, or empty. The renderer only uses it when it loads cleanly. */
export function faviconUrlFor(config: Pick<StudioConfig, 'websiteColumn'>, contact: Contact) {
  const host = companyHost(config, contact);
  return host ? `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=256` : '';
}

/** A site icon smaller than this is the generic globe (or too blurry to enlarge), so initials win. */
export const MIN_FAVICON_PX = 48;
