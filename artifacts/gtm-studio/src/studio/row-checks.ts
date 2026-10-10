import { z } from 'zod';
import { missingTags, type MergeOptions } from './merge';
import type { Contact } from './types';

export type RowIssue = { row: number; problems: string[] };

const IMAGE_KEY = /image|photo|avatar|picture|portrait/i;
const linkLike = z.string().refine(
  (value) => /^(https?:\/\/|data:image\/|\/)/i.test(value.trim()),
  'is not a web link',
);
const emailLike = z.string().email();

function readable(tag: string) {
  return tag.split('|')[0].trim().replace(/_/g, ' ');
}

/**
 * Checks each imported row against what the copy needs and what the studio can draw:
 * merge tags with no value and no fallback, image columns that are not links, and bad emails.
 * Returns plain sentences per row; it never blocks an import.
 */
export function checkRows(rows: Contact[], copy: string, options: MergeOptions = {}): RowIssue[] {
  const rowSchema = z.record(z.unknown()).superRefine((contact, ctx) => {
    for (const [key, raw] of Object.entries(contact)) {
      const value = typeof raw === 'string' ? raw.trim() : '';
      if (!value) continue;
      if (IMAGE_KEY.test(key) && !key.startsWith('_') && !linkLike.safeParse(value).success) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${readable(key)} is not a web link` });
      }
      if (/^e-?mail$/i.test(key) && !emailLike.safeParse(value).success) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'email address looks wrong' });
      }
    }
    const missing = missingTags(copy, contact as Contact, options);
    for (const tag of missing) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `no ${readable(tag)}` });
    }
  });
  const issues: RowIssue[] = [];
  rows.forEach((contact, index) => {
    const result = rowSchema.safeParse(contact);
    if (!result.success) {
      issues.push({ row: Number(contact.row) || index + 1, problems: result.error.issues.map((issue) => issue.message) });
    }
  });
  return issues;
}

/** "Row 12: no first name, image link is not a web link" */
export function describeIssue(issue: RowIssue) {
  return `Row ${issue.row}: ${issue.problems.join(', ')}`;
}

export type RowRef = { index: number; row: number };
export type RowWarning = RowRef & { problems: string[] };

/**
 * Avatar card rows that will not look as planned, merged per row in list order: no portrait (the card
 * gets an initials or site-icon badge instead) and a letter too long for its frame even at the smallest size.
 */
export function avatarRowWarnings(missingPortrait: RowRef[], overflowing: RowRef[]): RowWarning[] {
  const byIndex = new Map<number, RowWarning>();
  const add = (ref: RowRef, problem: string) => {
    const entry = byIndex.get(ref.index) ?? { ...ref, problems: [] };
    entry.problems.push(problem);
    byIndex.set(ref.index, entry);
  };
  missingPortrait.forEach((ref) => add(ref, 'no portrait'));
  overflowing.forEach((ref) => add(ref, 'letter cut off'));
  return [...byIndex.values()].sort((a, b) => a.index - b.index);
}
