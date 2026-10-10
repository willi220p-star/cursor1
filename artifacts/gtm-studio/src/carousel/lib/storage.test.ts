import { describe, expect, it } from 'vitest';
import { defaultValues } from './default-document';
import { DocumentSchema } from './validation/document-schema';
import {
  carouselFilename,
  carouselIdFromPath,
  carouselStoragePath,
  mergeCarouselLists,
  parseCarousel,
  serializeCarousel,
} from './storage';

const id = '6f1c2a9e-1111-4222-8333-444455556666';
const userId = '00000000-0000-4000-8000-000000000001';

describe('carousel storage serializer', () => {
  it('round-trips a document through the JSON envelope', () => {
    const document = DocumentSchema.parse(defaultValues);
    const text = serializeCarousel(document, { id, title: '  Q4   hooks ', savedAt: '2026-10-01T00:00:00.000Z' });
    const parsed = parseCarousel(text);
    expect(parsed).toMatchObject({ kind: 'dgk-carousel', version: 1, id, title: 'Q4 hooks', savedAt: '2026-10-01T00:00:00.000Z' });
    expect(parsed.document).toEqual(document);
  });

  it('accepts an older bare document and fills the page format', () => {
    const { format: _format, ...config } = defaultValues.config;
    const parsed = parseCarousel(JSON.stringify({ ...defaultValues, config }), { id, title: 'Legacy' });
    expect(parsed.id).toBe(id);
    expect(parsed.title).toBe('Legacy');
    expect(parsed.document.config.format).toBe('portrait');
  });

  it('rejects broken or newer files', () => {
    expect(() => parseCarousel('not json')).toThrow(/not valid JSON/);
    expect(() => parseCarousel(JSON.stringify({ kind: 'dgk-carousel', version: 1, document: { slides: 'x' } }))).toThrow(/missing slides/);
    expect(() => parseCarousel(JSON.stringify({ kind: 'dgk-carousel', version: 99, document: defaultValues }))).toThrow(/newer version/);
  });

  it('keeps files in the user folder with a .json name', () => {
    expect(carouselStoragePath(userId, id)).toBe(`${userId}/carousels/${id}.json`);
    expect(carouselIdFromPath(`${userId}/carousels/${id}.json`)).toBe(id);
    expect(() => carouselStoragePath(userId, '../x')).toThrow();
    expect(carouselFilename('a/b: deck')).toBe('a-b: deck.json');
  });

  it('prefers cloud copies and sorts newest first', () => {
    const merged = mergeCarouselLists(
      [{ id: 'a', title: 'Cloud A', savedAt: '2026-10-02', storagePath: 'p', cloud: true }],
      [
        { id: 'a', title: 'Local A', savedAt: '2026-10-01', storagePath: '', cloud: false },
        { id: 'b', title: 'Local B', savedAt: '2026-10-03', storagePath: '', cloud: false },
      ],
    );
    expect(merged.map((item) => item.title)).toEqual(['Local B', 'Cloud A']);
  });
});
