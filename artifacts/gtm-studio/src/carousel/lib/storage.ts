import { DocumentSchema } from "@/carousel/lib/validation/document-schema";
import type { CarouselDocument } from "@/carousel/lib/personalise";

/**
 * Saved carousels are JSON text files in the outbound-assets bucket plus an outbound_assets row
 * tagged { kind: 'carousel' }. The campaign/template tables only accept studio modes, so the
 * deck lives in storage instead of a table. The same envelope is kept in localStorage offline.
 */
export const CAROUSEL_FILE_KIND = "dgk-carousel";
export const CAROUSEL_FILE_VERSION = 1;

export type CarouselEnvelope = {
  kind: typeof CAROUSEL_FILE_KIND;
  version: number;
  id: string;
  title: string;
  savedAt: string;
  document: CarouselDocument;
};

export type SavedCarousel = {
  id: string;
  title: string;
  savedAt: string;
  /** Storage path when the deck is in Supabase; empty for a deck only kept on this device. */
  storagePath: string;
  cloud: boolean;
};

const ID_PATTERN = /^[a-z0-9-]{8,64}$/i;

export function cleanCarouselTitle(value: string) {
  return value.replace(/\s+/g, " ").trim().slice(0, 80) || "Untitled carousel";
}

export function carouselFilename(title: string) {
  return `${cleanCarouselTitle(title).replace(/[\\/]+/g, "-")}.json`;
}

export function carouselStoragePath(userId: string, id: string) {
  if (!ID_PATTERN.test(id)) throw new Error("Carousel id is not valid.");
  return `${userId}/carousels/${id}.json`;
}

export function carouselIdFromPath(path: string) {
  const match = /\/carousels\/([a-z0-9-]+)\.json$/i.exec(path);
  return match?.[1] ?? "";
}

export function serializeCarousel(document: CarouselDocument, meta: { id: string; title: string; savedAt?: string }) {
  const envelope: CarouselEnvelope = {
    kind: CAROUSEL_FILE_KIND,
    version: CAROUSEL_FILE_VERSION,
    id: meta.id,
    title: cleanCarouselTitle(meta.title),
    savedAt: meta.savedAt ?? new Date().toISOString(),
    document,
  };
  return JSON.stringify(envelope);
}

/** Reads a saved carousel file. A bare document (the older JSON export) is accepted too. */
export function parseCarousel(text: string, fallback: { id?: string; title?: string } = {}): CarouselEnvelope {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error("That carousel file is not valid JSON.");
  }
  if (!raw || typeof raw !== "object") throw new Error("That carousel file is empty.");
  const record = raw as Record<string, unknown>;
  const isEnvelope = record.kind === CAROUSEL_FILE_KIND;
  if (isEnvelope && typeof record.version === "number" && record.version > CAROUSEL_FILE_VERSION) {
    throw new Error("That carousel was saved by a newer version of the studio.");
  }
  const parsed = DocumentSchema.safeParse(isEnvelope ? record.document : raw);
  if (!parsed.success) throw new Error("That carousel file is missing slides or settings.");
  const title = typeof record.title === "string" ? record.title : fallback.title || parsed.data.filename;
  return {
    kind: CAROUSEL_FILE_KIND,
    version: CAROUSEL_FILE_VERSION,
    id: typeof record.id === "string" && ID_PATTERN.test(record.id) ? record.id : fallback.id || newCarouselId(),
    title: cleanCarouselTitle(title),
    savedAt: typeof record.savedAt === "string" ? record.savedAt : new Date(0).toISOString(),
    document: parsed.data,
  };
}

export function newCarouselId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

// Local fallback ---------------------------------------------------------------------------------

const LOCAL_LIBRARY = "gtm-carousel-library";
const CURRENT_ID = "gtm-carousel-current";
const localKey = (userId?: string) => `${LOCAL_LIBRARY}:${userId ?? "anonymous"}`;

function readLocal(userId?: string): CarouselEnvelope[] {
  try {
    const list = JSON.parse(localStorage.getItem(localKey(userId)) || "[]") as unknown;
    return Array.isArray(list) ? (list as CarouselEnvelope[]) : [];
  } catch {
    return [];
  }
}

/** Keeps a copy on this device. Returns false when storage is full or blocked. */
export function saveLocalCarousel(envelope: CarouselEnvelope, userId?: string) {
  try {
    const rest = readLocal(userId).filter((item) => item.id !== envelope.id);
    localStorage.setItem(localKey(userId), JSON.stringify([envelope, ...rest].slice(0, 30)));
    return true;
  } catch {
    return false;
  }
}

export function listLocalCarousels(userId?: string): SavedCarousel[] {
  return readLocal(userId).map((item) => ({ id: item.id, title: item.title, savedAt: item.savedAt, storagePath: "", cloud: false }));
}

export function loadLocalCarousel(id: string, userId?: string) {
  const found = readLocal(userId).find((item) => item.id === id);
  return found ? parseCarousel(JSON.stringify(found)) : null;
}

export function removeLocalCarousel(id: string, userId?: string) {
  try {
    localStorage.setItem(localKey(userId), JSON.stringify(readLocal(userId).filter((item) => item.id !== id)));
  } catch {
    // Nothing stored to remove.
  }
}

/** Cloud entries win over local copies of the same deck; newest first. */
export function mergeCarouselLists(cloud: SavedCarousel[], local: SavedCarousel[]) {
  const byId = new Map<string, SavedCarousel>();
  for (const item of local) byId.set(item.id, item);
  for (const item of cloud) byId.set(item.id, item);
  return [...byId.values()].sort((a, b) => b.savedAt.localeCompare(a.savedAt));
}

export function readCurrentCarouselId() {
  try {
    return localStorage.getItem(CURRENT_ID) || "";
  } catch {
    return "";
  }
}

export function writeCurrentCarouselId(id: string) {
  try {
    if (id) localStorage.setItem(CURRENT_ID, id);
    else localStorage.removeItem(CURRENT_ID);
  } catch {
    // Storage blocked; the next save makes a new copy.
  }
}
