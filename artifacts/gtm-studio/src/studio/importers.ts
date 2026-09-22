import Papa from 'papaparse';
import { internalContactKeys, type Contact } from './types';
import { normalizeHeader } from './merge';

export type ImportedList = {
  rows: Contact[];
  columns: string[];
};

function normalizeRows(rows: Record<string, unknown>[]) {
  return rows
    .filter((row) => Object.values(row).some((value) => String(value ?? '').trim()))
    .map((row, index) => {
      const normalized = Object.fromEntries(
        Object.entries(row).map(([key, value]) => [normalizeHeader(key), value == null ? '' : String(value)]),
      ) as Contact;
      normalized.row = index + 2;
      return normalized;
    });
}

function assertUniqueHeaders(headers: unknown[]) {
  const normalized = headers.map((header) => normalizeHeader(String(header ?? '')));
  if (normalized.some((header) => !header)) throw new Error('Every spreadsheet column needs a header.');
  const duplicates = [...new Set(normalized.filter((header, index) => normalized.indexOf(header) !== index))];
  if (duplicates.length) throw new Error(`Duplicate columns after normalisation: ${duplicates.join(', ')}.`);
  return normalized;
}

function finishImport(rows: Contact[], columns: string[]): ImportedList {
  if (!rows.length) throw new Error('No prospect rows were found.');
  return { rows: prepareImportedContacts(rows), columns };
}

export async function importProspectFile(file: File): Promise<ImportedList> {
  if (file.size > 15 * 1024 * 1024) throw new Error('Prospect files must be 15 MB or smaller.');
  const extension = file.name.split('.').pop()?.toLowerCase();
  if (extension === 'csv') {
    const source = await file.text();
    const headerPreview = Papa.parse<string[]>(source, { preview: 1, skipEmptyLines: true });
    if (headerPreview.errors.length) throw new Error(headerPreview.errors[0]?.message || 'Could not read CSV headers.');
    const columns = assertUniqueHeaders(headerPreview.data[0] ?? []);
    const parsed = Papa.parse<Record<string, unknown>>(source, {
      header: true,
      skipEmptyLines: true,
      transformHeader: normalizeHeader,
    });
    if (parsed.errors.length) throw new Error(parsed.errors[0]?.message || 'Could not parse CSV.');
    return finishImport(normalizeRows(parsed.data), columns);
  }

  if (!['xlsx', 'xls', 'ods'].includes(extension ?? '')) {
    throw new Error('Use a CSV, XLSX, XLS, or ODS file.');
  }
  const XLSX = await import('xlsx');
  const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array' });
  const firstSheet = workbook.SheetNames[0];
  if (!firstSheet) throw new Error('The spreadsheet has no sheets.');
  const headerRows = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[firstSheet], { header: 1, range: 0, blankrows: false });
  const columns = assertUniqueHeaders(headerRows[0] ?? []);
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets[firstSheet], { defval: '' });
  return finishImport(normalizeRows(rows), columns);
}

export function importProspectText(source: string): ImportedList {
  const trimmed = source.trim();
  if (!trimmed) throw new Error('Clipboard was empty. Copy cells from a spreadsheet first.');
  const delimiter = trimmed.includes('\t') ? '\t' : ',';
  const headerPreview = Papa.parse<string[]>(trimmed, { preview: 1, skipEmptyLines: true, delimiter });
  const columns = assertUniqueHeaders(headerPreview.data[0] ?? []);
  const parsed = Papa.parse<Record<string, unknown>>(trimmed, {
    header: true,
    skipEmptyLines: true,
    delimiter,
    transformHeader: normalizeHeader,
  });
  if (parsed.errors.length) throw new Error(parsed.errors[0]?.message || 'Could not parse pasted rows.');
  return finishImport(normalizeRows(parsed.data), columns);
}

function firstNameFrom(row: Contact) {
  const existing = String(row.first_name ?? '').trim();
  if (existing) return existing;
  const full = String(row.name || row.full_name || row.firstname || '').trim();
  return full.split(/\s+/)[0] || '';
}

export function prepareImportedContacts(rows: Contact[]): Contact[] {
  return rows.map((row) => {
    const firstName = firstNameFrom(row);
    if (!firstName) return row;
    return { ...row, first_name: String(row.first_name ?? '').trim() || firstName };
  });
}

export function contactColumns(contacts: Contact[]) {
  return Object.keys(contacts[0] ?? {}).filter((key) => !internalContactKeys.includes(key));
}
