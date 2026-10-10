import Papa from 'papaparse';
import { stripHookMarks } from './hook-mark';
import { contactColumns } from './importers';
import { renderMerge } from './merge';
import { rowRenderHash } from './row-hash';
import { configForRow, openerFor, rowVariant } from './variants';
import { isCutRoom, isPaperDesk, type Contact, type GeneratedAsset, type StudioConfig, type StudioMode } from './types';

export type StudioOutputColumns = {
  file: string;
  url: string;
  status: string;
  /** Plain-text version of what the image says, for the email's alt text. */
  alt: string;
  /** Hash of the row's render inputs when its file was made (row-hash.ts): unchanged rows can skip a rerender. */
  hash: string;
  /** A/B copy split and the opener behind the copy. Only studios that write a message have them. */
  variant?: string;
  opener?: string;
};

function columnsWithPrefix(prefix: string, split: boolean): StudioOutputColumns {
  return {
    file: `${prefix}_file`,
    url: `${prefix}_url`,
    status: `${prefix}_status`,
    alt: `${prefix}_alt`,
    hash: `${prefix}_hash`,
    ...(split ? { variant: `${prefix}_variant`, opener: `${prefix}_opener` } : {}),
  };
}

const OUTPUT_COLUMNS: Record<StudioMode, StudioOutputColumns> = {
  handwritten: columnsWithPrefix('handwritten', true),
  avatar: columnsWithPrefix('avatar_card', true),
  memes: columnsWithPrefix('meme', false),
  gif: columnsWithPrefix('gif', false),
  handgif: columnsWithPrefix('handwriting_gif', true),
};

export const ALT_TEXT_MAX = 300;

/** Collapse whitespace, drop leftover {tags} and stray braces, and cut on a word near the limit. */
export function cleanAltText(text: string, max = ALT_TEXT_MAX) {
  const flat = stripHookMarks(text)
    .replace(/\{[^{}]*\}/g, ' ')
    .replace(/[{}]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.;:!?])/g, '$1')
    .trim();
  if (flat.length <= max) return flat;
  const cut = flat.slice(0, max - 1);
  const space = cut.lastIndexOf(' ');
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,.;:–—-]+$/, '')}…`;
}

/**
 * What the image says for this row, as plain text, so an email client that blocks images
 * (Outlook does by default) still shows the message. Uses this row's A/B copy.
 */
export function altTextFor(config: StudioConfig, contact: Contact, mode: StudioMode = config.mode) {
  const row = configForRow(config, contact);
  const merge = (text: string | undefined) => (text ? renderMerge(text, contact, { hookColumn: row.hookColumn }) : '');
  let parts: string[];
  if (isCutRoom(mode)) {
    parts = (row.layers ?? []).map((layer) => merge(layer.text));
  } else {
    const postscript = merge(row.postscript).trim();
    const ps = postscript && !/^p\.?\s*s\b/i.test(postscript) ? `P.S. ${postscript}` : postscript;
    const message = mode === 'avatar' && row.showMessage !== false
      ? (row.messageColumn ? String(contact[row.messageColumn] ?? '').trim() : '') || merge(row.message).trim()
      : '';
    parts = [merge(row.copy), message, merge(row.signature), ps];
  }
  return cleanAltText(parts.map((part) => part.trim()).filter(Boolean).join(' '));
}

export type ListMeta = {
  fieldMap?: StudioConfig['fieldMap'];
  listSource?: string;
  sourceColumns?: string[];
  avatarColumn?: string;
  messageColumn?: string;
};

const listMetaKey = (scope: string, mode: StudioMode) => `gtm-list-meta:${scope}:${mode}`;

export function outputColumnsFor(mode: StudioMode): StudioOutputColumns {
  return OUTPUT_COLUMNS[mode];
}

export function outputColumnNames(mode: StudioMode) {
  const cols = outputColumnsFor(mode);
  return [cols.file, cols.url, cols.status, cols.alt, cols.hash, ...(cols.variant ? [cols.variant] : []), ...(cols.opener ? [cols.opener] : []), 'image_url', 'smartlead_image_url'];
}

export function persistListMeta(scope: string, modes: StudioMode[], meta: ListMeta) {
  const payload = JSON.stringify(meta);
  modes.forEach((item) => localStorage.setItem(listMetaKey(scope, item), payload));
}

export function readListMeta(scope: string, mode: StudioMode): ListMeta | null {
  try {
    const raw = localStorage.getItem(listMetaKey(scope, mode));
    if (!raw) return null;
    return JSON.parse(raw) as ListMeta;
  } catch {
    return null;
  }
}

export function ensureOutputFields(map: StudioConfig['fieldMap'], mode: StudioMode): NonNullable<StudioConfig['fieldMap']> {
  const current = map ? [...map] : [];
  for (const column of outputColumnNames(mode)) {
    const exists = current.some((item) => item.column === column || item.customTag === column);
    if (!exists) current.push({ column, use: 'custom', customTag: column, detected: false });
  }
  return current;
}

function cellValue(value: string | number | undefined) {
  const text = String(value ?? '');
  if (text.startsWith('data:')) return '';
  if (/^[=+\-@|]/.test(text)) return `'${text}`;
  return text;
}

export function listExportColumns(rows: Contact[], sourceColumns?: string[], mode?: StudioMode) {
  const present = new Set(contactColumns(rows));
  const ordered: string[] = [];
  const add = (column: string) => {
    if (present.has(column) && !ordered.includes(column)) ordered.push(column);
  };
  if (sourceColumns?.length) {
    sourceColumns.forEach(add);
    (mode ? [mode, ...(['handwritten', 'avatar', 'memes', 'gif', 'handgif'] as StudioMode[]).filter((item) => item !== mode)] : ['handwritten', 'avatar', 'memes', 'gif', 'handgif'] as StudioMode[])
      .forEach((item) => outputColumnNames(item).forEach(add));
    return ordered;
  }
  if (mode) outputColumnNames(mode).forEach(add);
  contactColumns(rows).forEach(add);
  return ordered;
}

export function csvDownloadName(listSource?: string, campaignName?: string) {
  const raw = listSource && !['pasted spreadsheet', 'current list', 'messy-prospects.csv'].includes(listSource)
    ? listSource
    : `${campaignName || 'prospects'}.csv`;
  const base = raw.replace(/\.[^.]+$/, '').replace(/[^\w.-]+/g, '-') || 'prospects';
  return `${base}-with-assets.csv`;
}

export function contactsToCsv(rows: Contact[], columns?: string[]) {
  const fields = (columns?.length ? columns : contactColumns(rows)).filter((column) => column !== 'row');
  return Papa.unparse({
    fields,
    data: rows.map((row) => fields.map((column) => cellValue(row[column]))),
  });
}

export function exportListCsv(rows: Contact[], config: Pick<StudioConfig, 'sourceColumns' | 'listSource' | 'campaignName'>, mode: StudioMode) {
  const columns = listExportColumns(rows, config.sourceColumns, mode);
  return {
    csv: contactsToCsv(rows, columns),
    filename: csvDownloadName(config.listSource, config.campaignName),
    columns,
  };
}

/**
 * Writes the generated file, link and status onto each row that has an asset. With the studio
 * config it also writes the alt text, the A/B variant and the opener id for that row.
 */
export function stampStudioOutputs(rows: Contact[], assets: GeneratedAsset[], mode: StudioMode, config?: StudioConfig): Contact[] {
  if (!assets.length) return rows;
  const cols = outputColumnsFor(mode);
  const byRow = new Map(assets.map((asset) => [asset.row, asset]));
  return rows.map((row) => {
    const asset = byRow.get(row.row);
    if (!asset) return row;
    const failed = asset.status === 'failed' || !asset.filename;
    const publicUrl = asset.publicUrl?.trim() ?? '';
    const file = failed ? '' : asset.filename;
    const url = publicUrl || file;
    const extra: Record<string, string> = {};
    if (config) {
      extra[cols.alt] = altTextFor(config, row, mode);
      if (cols.variant && isPaperDesk(mode)) extra[cols.variant] = rowVariant(config, row);
      if (cols.opener && isPaperDesk(mode)) extra[cols.opener] = openerFor(config, row);
      extra[cols.hash] = failed ? '' : rowRenderHash(config, row, mode);
    }
    return {
      ...row,
      ...extra,
      [cols.file]: file,
      [cols.url]: url,
      [cols.status]: failed ? (asset.error || 'failed') : (asset.uploadStatus === 'failed' ? 'generated' : (publicUrl ? 'uploaded' : 'generated')),
      image_url: url,
      smartlead_image_url: url,
    };
  });
}

export function withOutputFieldMap(config: StudioConfig, mode: StudioMode): StudioConfig {
  return { ...config, fieldMap: ensureOutputFields(config.fieldMap, mode) };
}
