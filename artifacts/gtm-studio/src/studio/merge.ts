import { stripHookMarks, wrapHook } from './hook-mark';
import { hookColumnAliases, internalContactKeys, type Contact } from './types';

export type MergeOptions = {
  /** Column {hook} reads from; guessed from common names when unset or not in this row. */
  hookColumn?: string;
  /** Wrap the hook in private-use sentinels for the canvas renderer. Never for anything shown as text. */
  markHook?: boolean;
};

export function normalizeHeader(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, '_');
}

function seededChoice(options: string[], row: number, source: string) {
  let hash = row * 31;
  for (const character of source) hash = (hash * 33 + character.charCodeAt(0)) >>> 0;
  return options[hash % options.length] ?? options[0] ?? '';
}

const mergeAliases: Record<string, string[]> = {
  first_name: ['first_name', 'name', 'full_name', 'firstname', 'first', 'contact', 'person'],
  name: ['name', 'full_name', 'first_name', 'firstname', 'contact', 'person'],
  company: ['company', 'company_name', 'organisation', 'organization', 'org', 'business', 'employer'],
  msg: ['msg', 'message', 'note', 'personal_message', 'body', 'copy'],
  message: ['message', 'msg', 'note', 'personal_message', 'body'],
  email: ['email', 'email_address', 'work_email', 'e_mail'],
  role: ['role', 'title', 'job_title', 'job', 'position'],
  city: ['city', 'location', 'suburb', 'town'],
};

function lookupAliases(key: string) {
  return mergeAliases[key] ?? [key];
}

const has = (contact: Contact, key: string) => Object.prototype.hasOwnProperty.call(contact, key);

/**
 * The column {hook} reads for this row: the chosen one, else a column named like a personal
 * line (hook, icebreaker, personalization, first_line...). Link columns never count.
 */
export function resolveHookColumn(contact: Contact, hookColumn?: string) {
  if (hookColumn) {
    if (has(contact, hookColumn)) return hookColumn;
    if (has(contact, normalizeHeader(hookColumn))) return normalizeHeader(hookColumn);
  }
  const keys = Object.keys(contact).filter((key) => !internalContactKeys.includes(key) && !/url|link/i.test(key));
  const lower = keys.map((key) => normalizeHeader(key));
  for (const alias of hookColumnAliases) {
    const index = lower.indexOf(alias);
    if (index >= 0) return keys[index];
  }
  for (const alias of hookColumnAliases) {
    const index = lower.findIndex((key) => key.includes(alias));
    if (index >= 0) return keys[index];
  }
  return '';
}

export function renderMerge(text: string, contact: Contact, options: MergeOptions = {}) {
  return text.replace(/\{([^{}]+)\}/g, (full, expression: string) => {
    const parts = expression.split('|').map((part) => part.trim());
    const key = normalizeHeader(parts[0] ?? '');
    if (key === 'row') return String(contact.row);
    if (key === 'hook') {
      const column = resolveHookColumn(contact, options.hookColumn);
      if (column) {
        const value = stripHookMarks(String(contact[column] ?? '')).trim() || parts[1] || '';
        return value && options.markHook ? wrapHook(value) : value;
      }
    }
    const aliases = lookupAliases(key);
    const takeFirst = key === 'first_name';
    for (const alias of aliases) {
      if (Object.prototype.hasOwnProperty.call(contact, alias)) {
        const value = String(contact[alias] ?? '').trim();
        if (value) return takeFirst && (alias === 'name' || alias === 'full_name') ? value.split(/\s+/)[0] : value;
        if (alias === key) return parts[1] || '';
      }
    }
    if (parts.length > 2) return seededChoice(parts, contact.row, expression);
    if (parts.length === 2 && !/^[a-z0-9_ ]+$/i.test(parts[0] ?? '')) {
      return seededChoice(parts, contact.row, expression);
    }
    if (parts.length >= 2 && parts.every((part) => !Object.prototype.hasOwnProperty.call(contact, normalizeHeader(part)))) {
      return parts[1] && /^[a-z0-9_ ]+$/i.test(parts[0] ?? '') ? (parts[1] || '') : seededChoice(parts, contact.row, expression);
    }
    return full;
  });
}

export function unresolvedTags(text: string, contact: Contact, options: MergeOptions = {}) {
  const rendered = renderMerge(text, contact, { hookColumn: options.hookColumn });
  return [...rendered.matchAll(/\{([^{}]+)\}/g)].map((match) => match[1]);
}

/**
 * Tags with no fallback that come out empty for this row because the cell is blank,
 * e.g. "loved how fast {company} moved" when the company cell is empty.
 */
export function blankTags(text: string, contact: Contact, options: MergeOptions = {}) {
  const blanks: string[] = [];
  for (const match of text.matchAll(/\{([^{}]+)\}/g)) {
    const expression = match[1];
    if (expression.includes('|')) continue;
    const rendered = renderMerge(match[0], contact, { hookColumn: options.hookColumn });
    if (!rendered.trim() && !blanks.includes(expression.trim())) blanks.push(expression.trim());
  }
  return blanks;
}

/** Everything that would make this row read wrong: unknown tags and blank cells without a fallback. */
export function missingTags(text: string, contact: Contact, options: MergeOptions = {}) {
  return [...new Set([...unresolvedTags(text, contact, options), ...blankTags(text, contact, options)])];
}

export function safeFilename(pattern: string, contact: Contact, extension: string) {
  const base = stripHookMarks(renderMerge(pattern, contact))
    .normalize('NFKD')
    .replace(/[^\w.-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '') || `row_${contact.row}`;
  return `${base}.${extension}`;
}
