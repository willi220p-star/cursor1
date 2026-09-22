import type { Contact } from './types';

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

export function renderMerge(text: string, contact: Contact) {
  return text.replace(/\{([^{}]+)\}/g, (full, expression: string) => {
    const parts = expression.split('|').map((part) => part.trim());
    const key = normalizeHeader(parts[0] ?? '');
    if (key === 'row') return String(contact.row);
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

export function unresolvedTags(text: string, contact: Contact) {
  const rendered = renderMerge(text, contact);
  return [...rendered.matchAll(/\{([^{}]+)\}/g)].map((match) => match[1]);
}

export function safeFilename(pattern: string, contact: Contact, extension: string) {
  const base = renderMerge(pattern, contact)
    .normalize('NFKD')
    .replace(/[^\w.-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '') || `row_${contact.row}`;
  return `${base}.${extension}`;
}
