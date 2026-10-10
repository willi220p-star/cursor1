import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { GUIDE_RELEASE, guideContent, whatsNew, whatsNewFor, type GuideKey } from './guide-content';
import { studios } from './studios';

const src = fileURLToPath(new URL('..', import.meta.url));

function readTree(relative: string): string {
  const full = join(src, relative);
  if (statSync(full).isFile()) return readFileSync(full, 'utf8');
  return readdirSync(full)
    .filter((name) => !name.includes('.test.') && !name.startsWith('guide-'))
    .map((name) => {
      const child = join(relative, name);
      const stat = statSync(join(src, child));
      if (stat.isDirectory()) return readTree(child);
      return /\.(tsx?|css)$/.test(name) ? readFileSync(join(src, child), 'utf8') : '';
    })
    .join('\n');
}

const studioSources = ['components/studio-generator.tsx', 'components/studio', 'studio/types.ts', 'studio/audience.ts', 'studio/writeback.ts', 'studio/defaults.ts'];

/** Where each guide's labels must appear. */
const sourcesFor: Record<GuideKey, string[]> = {
  handwritten: studioSources,
  handgif: studioSources,
  avatar: studioSources,
  memes: studioSources,
  gif: studioSources,
  carousel: ['carousel'],
  desk: ['pages/desk.tsx', 'components/studio/library.tsx', 'components/studio-generator.tsx'],
};

const allKeys = [...studios.map((studio) => studio.key), 'desk'] as GuideKey[];

describe('how it works guide', () => {
  it('covers every studio and the Desk with steps and tips', () => {
    for (const key of allKeys) {
      const entry = guideContent[key];
      expect(entry, key).toBeDefined();
      expect(entry.steps.length, `${key} steps`).toBeGreaterThanOrEqual(4);
      expect(entry.steps.length, `${key} steps`).toBeLessThanOrEqual(6);
      expect(entry.tips.length, `${key} tips`).toBeGreaterThanOrEqual(3);
      expect(entry.tips.length, `${key} tips`).toBeLessThanOrEqual(5);
      for (const item of [...entry.steps, ...entry.tips]) {
        expect(item.title.trim(), key).not.toBe('');
        expect(item.body.trim(), key).not.toBe('');
      }
    }
  });

  it('only points at labels that exist in the app', () => {
    const missing: string[] = [];
    for (const key of allKeys) {
      const source = sourcesFor[key].map(readTree).join('\n');
      for (const item of [...guideContent[key].steps, ...guideContent[key].tips]) {
        for (const label of item.labels ?? []) {
          if (!source.includes(label)) missing.push(`${key}: "${label}" (${item.title})`);
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it('follows the copy rules: sentence case, no arrows, no all-caps words', () => {
    const texts = allKeys.flatMap((key) => {
      const entry = guideContent[key];
      return [entry.heading, entry.intro, ...entry.steps.flatMap((item) => [item.title, item.body]), ...entry.tips.flatMap((item) => [item.title, item.body])];
    }).concat(whatsNew.map((item) => item.text));
    for (const text of texts) {
      expect(text, text).not.toMatch(/[→←⟶»]|->/);
      // Merge-tag fallbacks like {first_name|THERE} copy the app's own sample text, so skip braces.
      expect(text.replace(/\{[^}]*\}/g, ''), text).not.toMatch(/\b(?!JPG\b|PNG\b|GIF\b|GIFs\b|CSV\b|ZIP\b|PDF\b|PDFs\b|DM\b|MB\b|KB\b|URL\b|A\/B\b)[A-Z]{3,}\b/);
    }
  });

  it('has a What’s new list for every guide and a release string', () => {
    expect(GUIDE_RELEASE).toMatch(/\S/);
    for (const key of allKeys) expect(whatsNewFor(key).length, key).toBeGreaterThan(0);
    expect(whatsNew.map((item) => item.text)).toContain('Big lists run in 400-row chunks');
    expect(whatsNew.map((item) => item.text)).toContain('Clean up old versions from a campaign’s menu');
  });
});
