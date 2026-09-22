/** Prefix root-relative public files so they work under GitHub Pages `/cursor1/`. */
export function publicAssetUrl(url?: string | null) {
  const value = String(url ?? '').trim();
  if (!value) return '';
  if (/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(value)) return value;
  if (!value.startsWith('/')) return value;
  const base = String(import.meta.env.BASE_URL ?? '/').replace(/\/$/, '');
  if (!base || value === base || value.startsWith(`${base}/`)) return value;
  return `${base}${value}`;
}
