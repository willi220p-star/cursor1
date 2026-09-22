import { publicAssetUrl } from '@/lib/utils';
import { importProspectText } from './importers';

const EXPORTS_KEY = 'gtm-studio-exports';
const SAMPLE_FLAG = 'gtm-studio-load-sample';
const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;

type ExportEvent = { at: number; count: number };

function exportsKey(scope: string) {
  return `${EXPORTS_KEY}:${scope}`;
}

function readExports(scope: string): ExportEvent[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(exportsKey(scope)) || '[]') as ExportEvent[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** Remember how many artefacts left the browser so the Desk can show a real metric. */
export function recordExport(scope: string, count: number) {
  if (!count) return;
  const cutoff = Date.now() - THIRTY_DAYS;
  const next = [...readExports(scope).filter((event) => event.at >= cutoff), { at: Date.now(), count }];
  try {
    localStorage.setItem(exportsKey(scope), JSON.stringify(next.slice(-500)));
  } catch {
    // Storage full or unavailable — the metric is best-effort.
  }
}

export function exportsInLast30Days(scope: string) {
  const cutoff = Date.now() - THIRTY_DAYS;
  return readExports(scope).filter((event) => event.at >= cutoff).reduce((sum, event) => sum + event.count, 0);
}

/** Desk → studio hand-off: ask the next studio to load the bundled sample list on mount. */
export function requestSampleList(scope: string) {
  localStorage.setItem(`${SAMPLE_FLAG}:${scope}`, '1');
}

export function consumeSampleListRequest(scope: string) {
  const key = `${SAMPLE_FLAG}:${scope}`;
  const wanted = localStorage.getItem(key) === '1';
  if (wanted) localStorage.removeItem(key);
  return wanted;
}

/** The bundled messy prospect list, run through the same importer as a real paste. */
export async function loadSampleList() {
  const response = await fetch(publicAssetUrl('/samples/messy-prospects.csv'));
  if (!response.ok) throw new Error(`The sample list could not be fetched (HTTP ${response.status}).`);
  return importProspectText(await response.text());
}

export function relativeTime(timestamp?: string | number | null) {
  if (!timestamp) return '—';
  const then = new Date(timestamp).getTime();
  if (!Number.isFinite(then)) return '—';
  const diff = Date.now() - then;
  const minutes = Math.round(diff / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days} d ago`;
  return new Date(then).toLocaleDateString();
}
