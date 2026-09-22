import { handwritingFonts, typedFonts } from './types';

/**
 * Fonts that only the rendered artefact needs (handwriting, meme headline, typed letter).
 * They are injected on demand so the app chrome ships with three families only.
 */
const artefactFamilies = [
  'Anton',
  ...handwritingFonts.map((font) => (font === 'Caveat' || font === 'Dancing Script' ? `${font}:wght@400..700` : font === 'Kalam' ? 'Kalam:wght@400;700' : font)),
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
