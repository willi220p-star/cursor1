import { publicAssetUrl } from '@/lib/utils';
import {
  AVATAR_CACHE_FIELD,
  AVATAR_SOURCE_FIELD,
  looksLikeImageSource,
  studioModes,
  type Contact,
  type StudioMode,
} from './types';

const DB_NAME = 'gtm-studio-portraits';
const STORE = 'pixels';
const memoryCache = new Map<string, string>();

export type PortraitHydrateStats = {
  total: number;
  cached: number;
  failed: number;
  done: boolean;
};

function openDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  return new Promise((resolve) => {
    try {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE)) {
          request.result.createObjectStore(STORE);
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export function peekPortraitCache(url?: string) {
  const key = url?.trim();
  if (!key) return '';
  if (key.startsWith('data:')) return key;
  return memoryCache.get(key) ?? '';
}

export async function readPortraitCache(url?: string) {
  const key = url?.trim();
  if (!key) return '';
  if (key.startsWith('data:')) return key;
  const remembered = memoryCache.get(key);
  if (remembered) return remembered;
  const db = await openDb();
  if (!db) return '';
  try {
    const value = await new Promise<string>((resolve) => {
      const tx = db.transaction(STORE, 'readonly');
      const request = tx.objectStore(STORE).get(key);
      request.onsuccess = () => resolve(typeof request.result === 'string' ? request.result : '');
      request.onerror = () => resolve('');
    });
    if (value) memoryCache.set(key, value);
    return value;
  } catch {
    return '';
  }
}

export async function writePortraitCache(url: string, dataUrl: string) {
  const key = url.trim();
  if (!key || !dataUrl.startsWith('data:')) return;
  memoryCache.set(key, dataUrl);
  if (key.startsWith('data:')) return;
  const db = await openDb();
  if (!db) return;
  try {
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(dataUrl, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch {
    // Keep the in-memory copy even if IndexedDB is full.
  }
}

function blobToDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Could not read image bytes.'));
    reader.readAsDataURL(blob);
  });
}

function loadHtmlImage(url: string, cors: boolean) {
  return new Promise<HTMLImageElement | null>((resolve) => {
    const image = new Image();
    if (cors) image.crossOrigin = 'anonymous';
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = url;
  });
}

function compressImage(image: HTMLImageElement) {
  const maxEdge = 720;
  const width = image.naturalWidth || image.width || 1;
  const height = image.naturalHeight || image.height || 1;
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const context = canvas.getContext('2d');
  if (!context) return '';
  context.fillStyle = '#f3ebe0';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  try {
    return canvas.toDataURL('image/jpeg', 0.84);
  } catch {
    return '';
  }
}

async function fetchAsDataUrl(url: string) {
  try {
    const response = await fetch(url, { mode: 'cors' });
    if (!response.ok) throw new Error('bad status');
    const blob = await response.blob();
    if (blob.size === 0) throw new Error('empty');
    const dataUrl = await blobToDataUrl(blob);
    const image = await loadHtmlImage(dataUrl, false);
    return image ? compressImage(image) || dataUrl : dataUrl;
  } catch {
    const corsImage = await loadHtmlImage(url, true);
    if (!corsImage) return '';
    return compressImage(corsImage);
  }
}

export async function snapshotPortrait(url?: string) {
  const key = url?.trim();
  if (!key) return '';
  const resolved = publicAssetUrl(key);
  const existing = await readPortraitCache(key) || await readPortraitCache(resolved);
  if (existing.startsWith('data:')) return existing;
  if (key.startsWith('data:')) {
    await writePortraitCache(key, key);
    return key;
  }
  if (typeof document === 'undefined') return existing;
  const captured = await fetchAsDataUrl(resolved);
  if (captured.startsWith('data:')) {
    await writePortraitCache(key, captured);
    if (resolved !== key) await writePortraitCache(resolved, captured);
    return captured;
  }
  return existing;
}

export function portraitUrlForRow(row: Contact, column?: string) {
  const cache = String(row[AVATAR_CACHE_FIELD] ?? '').trim();
  if (cache.startsWith('data:')) return cache;
  const source = String(row[AVATAR_SOURCE_FIELD] ?? '').trim();
  const fromColumn = column ? String(row[column] ?? '').trim() : '';
  return (
    peekPortraitCache(fromColumn)
    || peekPortraitCache(source)
    || peekPortraitCache(publicAssetUrl(fromColumn))
    || peekPortraitCache(publicAssetUrl(source))
    || publicAssetUrl(fromColumn)
    || publicAssetUrl(source)
    || publicAssetUrl(cache)
  );
}

function withPortrait(row: Contact, column: string | undefined, original: string, cached: string): Contact {
  const next: Contact = { ...row };
  if (original) next[AVATAR_SOURCE_FIELD] = original;
  if (cached.startsWith('data:')) next[AVATAR_CACHE_FIELD] = cached;
  if (column && original && !String(next[column] ?? '').trim()) next[column] = original;
  return next;
}

export async function attachPortraitCaches(rows: Contact[], column?: string) {
  const next = [...rows];
  await Promise.all(next.map(async (row, index) => {
    const original = column
      ? String(row[column] ?? row[AVATAR_SOURCE_FIELD] ?? '').trim()
      : String(row[AVATAR_SOURCE_FIELD] ?? '').trim();
    const existing = String(row[AVATAR_CACHE_FIELD] ?? '').trim();
    if (existing.startsWith('data:')) {
      if (original) await writePortraitCache(original, existing);
      return;
    }
    if (!looksLikeImageSource(original) && !original.startsWith('data:')) return;
    const cached = await readPortraitCache(original);
    if (cached.startsWith('data:')) next[index] = withPortrait(row, column, original, cached);
  }));
  return next;
}

export function stripPortraitDataUrls(rows: Contact[]): Contact[] {
  return rows.map((row) => {
    const next = { ...row };
    const cache = String(next[AVATAR_CACHE_FIELD] ?? '');
    if (cache.startsWith('data:')) delete next[AVATAR_CACHE_FIELD];
    return next;
  });
}

export function contactsStorageKey(scope: string, mode: StudioMode) {
  return `gtm-contacts:${scope}:${mode}`;
}

export function readStoredContacts(scope: string, mode: StudioMode) {
  try {
    const scoped = localStorage.getItem(contactsStorageKey(scope, mode));
    if (scoped) return JSON.parse(scoped) as Contact[];
    const legacy = localStorage.getItem(`gtm-contacts:${scope}`);
    if (legacy) {
      const rows = JSON.parse(legacy) as Contact[];
      studioModes.forEach((studio) => {
        if (!localStorage.getItem(contactsStorageKey(scope, studio.id))) {
          persistContactList(contactsStorageKey(scope, studio.id), rows);
        }
      });
      localStorage.removeItem(`gtm-contacts:${scope}`);
      return rows;
    }
  } catch {
    return null;
  }
  return null;
}

export function persistContactsForModes(scope: string, modes: StudioMode[], rows: Contact[]) {
  modes.forEach((item) => persistContactList(contactsStorageKey(scope, item), rows));
}

export function persistContactList(storageKey: string, rows: Contact[]) {
  const payload = JSON.stringify(stripPortraitDataUrls(rows));
  try {
    localStorage.setItem(storageKey, payload);
    return true;
  } catch {
    try {
      localStorage.setItem(storageKey, JSON.stringify(rows.map((row) => {
        const next: Contact = { row: row.row };
        for (const [key, value] of Object.entries(row)) {
          if (typeof value === 'string' && value.startsWith('data:image') && value.length > 120) continue;
          next[key] = value;
        }
        return next;
      })));
      return true;
    } catch {
      return false;
    }
  }
}

async function mapPool<T>(items: T[], limit: number, worker: (item: T, index: number) => Promise<void>) {
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      await worker(items[index], index);
    }
  });
  await Promise.all(runners);
}

export async function hydratePortraits(
  rows: Contact[],
  column: string,
  onChange: (next: Contact[], stats: PortraitHydrateStats) => void,
  signal?: { cancelled: boolean },
) {
  const restored = await attachPortraitCaches(rows, column);
  const targets = restored
    .map((row, index) => ({ row, index, url: String(row[column] ?? row[AVATAR_SOURCE_FIELD] ?? '').trim() }))
    .filter((item) => looksLikeImageSource(item.url) || item.url.startsWith('data:') || item.url.startsWith('/'));
  let cached = restored.filter((row) => String(row[AVATAR_CACHE_FIELD] ?? '').startsWith('data:')).length;
  let failed = 0;
  onChange(restored, { total: targets.length, cached, failed, done: targets.length === 0 });
  if (!targets.length) return restored;

  const working = [...restored];
  await mapPool(targets, 4, async (item) => {
    if (signal?.cancelled) return;
    const existing = String(working[item.index]?.[AVATAR_CACHE_FIELD] ?? '').trim();
    if (existing.startsWith('data:')) return;
    const captured = await snapshotPortrait(item.url);
    if (signal?.cancelled) return;
    if (captured.startsWith('data:')) {
      working[item.index] = withPortrait(working[item.index], column, item.url, captured);
      cached += 1;
    } else {
      failed += 1;
    }
  });
  if (!signal?.cancelled) onChange(working, { total: targets.length, cached, failed, done: true });
  return working;
}
