import { describe, expect, it } from 'vitest';
import { defaultValues } from './default-document';
import { DocumentSchema } from './validation/document-schema';
import {
  FALLBACK_CONTACT,
  capRows,
  documentMissingTags,
  documentText,
  hasMergeTags,
  personaliseDocument,
  personalisedFilenames,
  rowWarnings,
  slideImageFilenames,
  type CarouselDocument,
} from './personalise';
import { STARTER_DECKS } from './starter-decks';
import { getExportSize } from './page-size';

function deckWith(texts: string[]): CarouselDocument {
  const base = DocumentSchema.parse(defaultValues);
  return {
    ...base,
    slides: texts.map((text) => ({ ...base.slides[0], elements: [{ type: 'Title' as const, text, style: { fontSize: 'Medium' as const, align: 'Left' as const } }] })),
  };
}

describe('carousel personalisation', () => {
  it('fills merge tags per contact without touching the original deck', () => {
    const deck = deckWith(['Hi {first_name|there}', 'Built for {company|your team}']);
    const maya = personaliseDocument(deck, { row: 2, first_name: 'Maya', company: 'Top End Solar' });
    expect(documentText(maya).slice(0, 2)).toEqual(['Hi Maya', 'Built for Top End Solar']);
    expect(documentText(deck)[0]).toBe('Hi {first_name|there}');
  });

  it('uses fallbacks for the generic deck', () => {
    const deck = deckWith(['Hi {first_name|there}', 'For {company|your team}']);
    expect(documentText(personaliseDocument(deck, FALLBACK_CONTACT)).slice(0, 2)).toEqual(['Hi there', 'For your team']);
  });

  it('warns on blank cells and unknown tags without a fallback', () => {
    const deck = deckWith(['Loved what {company} shipped', 'Hi {first_name|there}']);
    expect(documentMissingTags(deck, { row: 2, first_name: 'Ethan', company: '' })).toEqual(['company']);
    expect(documentMissingTags(deck, { row: 3, first_name: 'Priya', company: 'Larrakia Legal' })).toEqual([]);
    const warnings = rowWarnings(deck, [
      { row: 2, first_name: 'Ethan', company: '' },
      { row: 3, first_name: 'Priya', company: 'Larrakia Legal' },
    ]);
    expect(warnings).toEqual([{ row: 2, label: 'Ethan', tags: ['company'] }]);
  });

  it('caps the list and makes unique, safe file names', () => {
    const rows = Array.from({ length: 205 }, (_, index) => ({ row: index + 2, first_name: 'Noah', company: 'Red Centre / Logistics' }));
    const { rows: kept, dropped } = capRows(rows);
    expect(kept).toHaveLength(200);
    expect(dropped).toBe(5);
    const names = personalisedFilenames(kept.slice(0, 3), '{first_name}-{company}');
    expect(names).toEqual(['Noah-Red_Centre_Logistics.pdf', 'Noah-Red_Centre_Logistics-2.pdf', 'Noah-Red_Centre_Logistics-3.pdf']);
  });

  it('numbers slide images in order', () => {
    expect(slideImageFilenames('My Carousel File', 3)).toEqual(['My-Carousel-File-01.png', 'My-Carousel-File-02.png', 'My-Carousel-File-03.png']);
  });

  it('starter decks validate and carry merge tags in the hook slide', () => {
    for (const starter of STARTER_DECKS) {
      const deck = DocumentSchema.parse({ ...defaultValues, slides: starter.slides() });
      expect(deck.slides.length).toBeGreaterThanOrEqual(5);
      expect(hasMergeTags({ ...deck, slides: deck.slides.slice(0, 1) })).toBe(true);
      expect(documentMissingTags(deck, FALLBACK_CONTACT)).toEqual([]);
    }
  });

  it('exports at LinkedIn sizes', () => {
    expect(getExportSize('portrait')).toMatchObject({ width: 1080, height: 1350 });
    expect(getExportSize('square')).toMatchObject({ width: 1080, height: 1080 });
  });
});
