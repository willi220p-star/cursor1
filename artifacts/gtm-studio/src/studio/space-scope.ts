/**
 * Module-level space state read by cloud.ts, so list and save functions keep their signatures
 * (callers such as the Library need no space argument). AccessProvider writes it on every render.
 * Plus the pure helpers that turn a space into storage paths and row payload fields.
 */

import type { Space } from './contracts';

let querySpace: string | null = null;
let saveSpace: string | null = null;
let knownSpaces: Space[] = [];

/** Spaces the signed-in user can see (empty in local mode / before the spaces migration). */
export function getKnownSpaces() {
  return knownSpaces;
}

export function setKnownSpaces(spaces: Space[]) {
  knownSpaces = spaces;
}

/** The space lists are filtered to; null = every space the user can see (RLS decides). */
export function getQuerySpace() {
  return querySpace;
}

export function setQuerySpace(spaceId: string | null) {
  querySpace = spaceId;
}

/** The space new rows and uploads go to; null = legacy per-user storage (local mode / pre-migration). */
export function getSaveSpace() {
  return saveSpace;
}

export function setSaveSpace(spaceId: string | null) {
  saveSpace = spaceId;
}

/** `spaces/<space>/<rest>` when a space is known, else the legacy `<userId>/<rest>`. */
export function storagePathFor(spaceId: string | null | undefined, userId: string, rest: string) {
  const tail = rest.replace(/^\/+/, '');
  return spaceId ? `spaces/${spaceId}/${tail}` : `${userId}/${tail}`;
}

/** Paths this app may write or delete: the user's legacy folder, or any space folder (RLS decides which). */
export function isManagedPath(path: string, userId: string) {
  return path.startsWith(`${userId}/`) || /^spaces\/[^/]+\//.test(path);
}

/** The space a `spaces/<id>/…` path belongs to, else null. */
export function spaceFromPath(path: string) {
  return /^spaces\/([^/]+)\//.exec(path)?.[1] ?? null;
}

/** Extra row fields for a new campaign/asset/folder row: `{ space_id }`, or nothing when no space is known. */
export function spaceFields(spaceId: string | null | undefined): { space_id?: string } {
  return spaceId ? { space_id: spaceId } : {};
}

/** True for a carousel file path in either layout. */
export function isCarouselPath(path: string, userId: string) {
  return path.startsWith(`${userId}/carousels/`) || /^spaces\/[^/]+\/carousels\//.test(path);
}
