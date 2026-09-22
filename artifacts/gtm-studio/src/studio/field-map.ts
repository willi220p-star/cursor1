import { guessAvatarColumn, guessColumn, internalContactKeys, messageColumnAliases, type Contact } from './types';
import { normalizeHeader } from './merge';

export const studioFields = ['name', 'company', 'role', 'city', 'email', 'portrait', 'message', 'website'] as const;
export type StudioField = (typeof studioFields)[number];
export type FieldUse = StudioField | 'custom' | 'ignore';

export type FieldAssignment = {
  column: string;
  use: FieldUse;
  customTag?: string;
  detected?: boolean;
};

export const studioFieldLabels: Record<StudioField, string> = {
  name: 'Name',
  company: 'Company',
  role: 'Role',
  city: 'City',
  email: 'Email',
  portrait: 'Portrait link',
  message: 'Message',
  website: 'Website',
};

const fieldAliases: Record<StudioField, string[]> = {
  name: ['name', 'full_name', 'contact_name', 'lead', 'prospect', 'person', 'contact', 'first_name', 'firstname', 'first'],
  company: ['company', 'company_name', 'organisation', 'organization', 'org', 'business', 'employer', 'account', 'account_name'],
  role: ['role', 'title', 'job_title', 'job', 'position', 'jobtitle', 'designation'],
  city: ['city', 'location', 'suburb', 'town'],
  email: ['email', 'email_address', 'work_email', 'e_mail'],
  portrait: [],
  message: messageColumnAliases,
  website: ['website', 'website_url', 'site'],
};

function firstWord(value: string | number) {
  return String(value ?? '').trim().split(/\s+/)[0] || String(value ?? '').trim();
}

export function detectFieldMap(columns: string[], rows: Contact[]): FieldAssignment[] {
  const fullerName = columns.some((column) => {
    const name = column.toLowerCase();
    return name === 'name' || name === 'full_name' || name === 'contact_name' || name === 'lead' || name === 'prospect' || name === 'person' || name === 'contact';
  });
  const usable = columns.filter((column) => {
    if (internalContactKeys.includes(column)) return false;
    if (fullerName && (column === 'first_name' || column === 'firstname')) return false;
    return true;
  });
  const taken = new Set<string>();
  const pick = (field: StudioField) => {
    const column = field === 'portrait'
      ? guessAvatarColumn(usable.filter((item) => !taken.has(item)), rows)
      : guessColumn(usable.filter((item) => !taken.has(item)), fieldAliases[field]);
    if (column) taken.add(column);
    return column;
  };
  const matches: Partial<Record<StudioField, string>> = {
    name: pick('name'),
    company: pick('company'),
    role: pick('role'),
    city: pick('city'),
    email: pick('email'),
    portrait: pick('portrait'),
    message: pick('message'),
    website: pick('website'),
  };
  return usable.map((column) => {
    const field = (Object.keys(matches) as StudioField[]).find((key) => matches[key] === column);
    if (field) return { column, use: field, detected: true };
    return { column, use: 'custom', customTag: column, detected: false };
  });
}

export function usedStudioFields(map: FieldAssignment[]) {
  return new Set(map.filter((item) => studioFields.includes(item.use as StudioField)).map((item) => item.use as StudioField));
}

export function unusedStudioFields(map: FieldAssignment[]) {
  const used = usedStudioFields(map);
  return studioFields.filter((field) => !used.has(field));
}

export function visibleAssignments(map: FieldAssignment[]) {
  return map.filter((item) => item.use !== 'ignore');
}

export function applyFieldMap(rows: Contact[], map: FieldAssignment[]): Contact[] {
  return rows.map((row) => {
    const next: Contact = { row: row.row };
    Object.entries(row).forEach(([key, value]) => {
      if (key === 'row') return;
      if (internalContactKeys.includes(key)) {
        next[key] = value;
        return;
      }
      const assignment = map.find((item) => item.column === key);
      if (!assignment || assignment.use === 'ignore') return;
      next[key] = value;
      if (assignment.use === 'name') {
        next.name = value;
        next.first_name = firstWord(value);
      }
      if (assignment.use === 'company') next.company = value;
      if (assignment.use === 'role') next.role = value;
      if (assignment.use === 'city') next.city = value;
      if (assignment.use === 'email') next.email = value;
      if (assignment.use === 'message') next.msg = value;
      if (assignment.use === 'website') next.website = value;
      if (assignment.use === 'custom') {
        const tag = normalizeHeader(assignment.customTag || key);
        if (tag && tag !== key) next[tag] = value;
      }
    });
    return next;
  });
}

export function assignmentLabel(item: FieldAssignment) {
  if (item.use === 'ignore') return 'Ignored';
  if (item.use === 'custom') return `{${item.customTag || item.column}}`;
  return studioFieldLabels[item.use];
}

export function columnForField(map: FieldAssignment[], field: StudioField) {
  return map.find((item) => item.use === field)?.column;
}

export function customTagName(value: string, fallback: string) {
  return normalizeHeader(value) || fallback;
}
