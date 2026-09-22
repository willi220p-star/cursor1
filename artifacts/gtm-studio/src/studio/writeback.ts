import Papa from 'papaparse';
import { contactColumns } from './importers';
import type { Contact, GeneratedAsset, StudioConfig, StudioMode } from './types';

export type StudioOutputColumns = {
  file: string;
  url: string;
  status: string;
};

const OUTPUT_COLUMNS: Record<StudioMode, StudioOutputColumns> = {
  handwritten: { file: 'handwritten_file', url: 'handwritten_url', status: 'handwritten_status' },
  avatar: { file: 'avatar_card_file', url: 'avatar_card_url', status: 'avatar_card_status' },
  memes: { file: 'meme_file', url: 'meme_url', status: 'meme_status' },
  gif: { file: 'gif_file', url: 'gif_url', status: 'gif_status' },
  handgif: { file: 'handwriting_gif_file', url: 'handwriting_gif_url', status: 'handwriting_gif_status' },
};

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
  return [cols.file, cols.url, cols.status, 'image_url', 'smartlead_image_url'];
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

export function stampStudioOutputs(rows: Contact[], assets: GeneratedAsset[], mode: StudioMode): Contact[] {
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
    return {
      ...row,
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
