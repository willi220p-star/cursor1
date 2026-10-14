import { handwritingFonts, legacyHandwritingFonts, typedFonts } from './types';

/**
 * Fonts that only the rendered artefact needs (handwriting, meme headline, typed letter).
 * They are injected on demand so the app chrome ships with three families only.
 * Handwriting here is the original seven; the other handwriting fonts load one by one (loadHandwritingFonts).
 */
const artefactFamilies = [
  'Anton',
  'Dancing Script:wght@400..700',
  ...legacyHandwritingFonts.map((font) => (font === 'Caveat' ? `${font}:wght@400..700` : font)),
  ...typedFonts.filter((font) => font !== 'Manrope').map((font) => `${font}:wght@500;600;700`),
];

const LINK_ID = 'gtm-artefact-fonts';
let pending: Promise<void> | null = null;

export function artefactFontsUrl() {
  const families = artefactFamilies.map((family) => `family=${family.replace(/ /g, '+')}`).join('&');
  return `https://fonts.googleapis.com/css2?${families}&display=swap`;
}

/** Inject the Google Fonts stylesheet for artefact fonts once; resolves when it has loaded. */
export function loadArtefactFonts(): Promise<void> {
  if (typeof document === 'undefined') return Promise.resolve();
  if (pending) return pending;
  const existing = document.getElementById(LINK_ID) as HTMLLinkElement | null;
  if (existing) {
    pending = Promise.resolve();
    return pending;
  }
  pending = new Promise<void>((resolve) => {
    const link = document.createElement('link');
    link.id = LINK_ID;
    link.rel = 'stylesheet';
    link.href = artefactFontsUrl();
    const done = () => resolve();
    link.addEventListener('load', done, { once: true });
    link.addEventListener('error', done, { once: true });
    document.head.appendChild(link);
    // Never block rendering on a slow font CDN.
    window.setTimeout(done, 4000);
  });
  return pending;
}

/**
 * Latin text to request when loading a handwriting face. Korean and Japanese families (Nanum, Gamja Flower,
 * Gaegu, Hi Melody, Yomogi) are served as unicode-range subsets, and a load with the default text can resolve
 * without ever fetching the Latin one.
 */
export const LATIN_SAMPLE = 'Hi Maya, loved the Darwin launch. 0123456789';

const requestedHandwriting = new Set<string>(legacyHandwritingFonts);

export function handwritingFontsUrl(fonts: readonly string[]) {
  const families = fonts.map((font) => `family=${font.replace(/ /g, '+')}`).join('&');
  return `https://fonts.googleapis.com/css2?${families}&display=swap`;
}

/** Injects one stylesheet for the handwriting fonts not requested yet (the picker and saved looks call this). */
export function loadHandwritingFonts(fonts: readonly string[]): Promise<void> {
  if (typeof document === 'undefined') return Promise.resolve();
  const wanted = fonts.filter((font) => (handwritingFonts as readonly string[]).includes(font) && !requestedHandwriting.has(font));
  if (!wanted.length) return Promise.resolve();
  wanted.forEach((font) => requestedHandwriting.add(font));
  return new Promise<void>((resolve) => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = handwritingFontsUrl(wanted);
    link.dataset.handwritingFonts = wanted.join(',');
    const done = () => resolve();
    link.addEventListener('load', done, { once: true });
    link.addEventListener('error', done, { once: true });
    document.head.appendChild(link);
    window.setTimeout(done, 4000);
  });
}

/** Makes sure a handwriting face has its stylesheet and its Latin glyphs, so canvas text draws in it. */
export async function ensureHandwritingFace(font: string, size = 30) {
  if (typeof document === 'undefined' || !document.fonts) return;
  await loadHandwritingFonts([font]);
  await document.fonts.load(`${size}px "${font}"`, LATIN_SAMPLE);
}
