/**
 * Bulk rename: names are computed in the browser from a pattern, then sent to bulk_rename.
 * Tokens: {name} (current name), {n} (1, 2, 3… in selection order), {date} (YYYY-MM-DD),
 * {client} (the campaign's client, or the client space). Unknown tokens are left as typed.
 */

export const RENAME_TOKENS = ['{name}', '{n}', '{date}', '{client}'] as const;

/** Longest name the library accepts (matches the single-item rename). */
export const RENAME_MAX = 120;

export interface RenameInput {
  name: string;
  client?: string | null;
}

export interface RenameOptions {
  date?: Date;
  /** Names already used by other items (case-insensitive); new names avoid them too. */
  taken?: Iterable<string>;
  /** First value of {n}. */
  start?: number;
}

/** Local calendar date, so "today" matches what the user sees. */
export function isoDate(date: Date) {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

// Separators left dangling when a token is empty, e.g. "{client} – {name}" without a client.
const EDGE_SEPARATORS = /^[\s\-–—_·|:,/]+|[\s\-–—_·|:,/]+$/g;

/** One name from the pattern, before de-duplication. Falls back to the current name when the result is empty. */
export function renderPattern(pattern: string, input: RenameInput, n: number, date: Date) {
  const client = (input.client ?? '').trim();
  const raw = pattern.replace(/\{(name|n|date|client)\}/gi, (_, token: string) => {
    switch (token.toLowerCase()) {
      case 'name': return input.name;
      case 'n': return String(n);
      case 'date': return isoDate(date);
      default: return client;
    }
  });
  // A dash between two empty tokens leaves "  –  "; collapse runs of separators made by empty tokens.
  const cleaned = raw
    .replace(/\s+/g, ' ')
    .replace(/(\s[-–—·|]\s)(?:[-–—·|]\s)+/g, '$1')
    .replace(EDGE_SEPARATORS, '')
    .trim()
    .slice(0, RENAME_MAX)
    .trim();
  return cleaned || input.name;
}

/** "Name (2)" for the second "Name", keeping the result inside RENAME_MAX. */
function withSuffix(name: string, copy: number) {
  const suffix = ` (${copy})`;
  return `${name.slice(0, RENAME_MAX - suffix.length).trimEnd()}${suffix}`;
}

/**
 * New names for every input, in order. Collisions inside the batch, or with `taken`, get " (2)",
 * " (3)"… (case-insensitive, like the database's unique checks).
 */
export function applyRenamePattern(pattern: string, inputs: readonly RenameInput[], options: RenameOptions = {}): string[] {
  const date = options.date ?? new Date();
  const start = options.start ?? 1;
  const used = new Set<string>();
  for (const name of options.taken ?? []) used.add(name.trim().toLowerCase());
  return inputs.map((input, index) => {
    const base = renderPattern(pattern, input, start + index, date);
    let name = base;
    for (let copy = 2; used.has(name.toLowerCase()); copy += 1) name = withSuffix(base, copy);
    used.add(name.toLowerCase());
    return name;
  });
}

/** True when the pattern changes at least one name (the Rename button stays off otherwise). */
export function patternChangesNames(pattern: string, inputs: readonly RenameInput[], options: RenameOptions = {}) {
  if (!pattern.trim()) return false;
  const names = applyRenamePattern(pattern, inputs, options);
  return names.some((name, index) => name !== inputs[index].name);
}
