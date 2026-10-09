import { describe, expect, it } from 'vitest';
import { baselineAt, buildRuleGrid, rowsAvailable, rowsNeeded, ruleStep } from './note-layout';
import { countWords, noteAdvice } from './note-advice';

const paper = { paperY: 40, paperH: 900, noteY: 0.12, lineSpacing: 1.35, scale: 1 };

describe('note line grid', () => {
  it('puts every written line on a rule at every font size', () => {
    for (let fontSize = 20; fontSize <= 72; fontSize += 4) {
      const grid = buildRuleGrid({ ...paper, fontSize });
      for (let row = 0; row < rowsAvailable(grid); row++) {
        const baseline = baselineAt(grid, row);
        expect(grid.rules.some((rule) => Math.abs(rule - baseline) < 0.01)).toBe(true);
      }
    }
  });

  it('rules the paper wider for bigger writing', () => {
    expect(ruleStep(56, 1.35, 1)).toBeGreaterThan(ruleStep(32, 1.35, 1));
    expect(ruleStep(10, 1.35, 1)).toBe(22);
    expect(ruleStep(40, undefined, 2)).toBe(Math.round(40 * 1.35) * 2);
  });

  it('keeps rules inside the paper', () => {
    const grid = buildRuleGrid({ ...paper, fontSize: 50 });
    expect(Math.min(...grid.rules)).toBeGreaterThanOrEqual(paper.paperY);
    expect(Math.max(...grid.rules)).toBeLessThanOrEqual(paper.paperY + paper.paperH);
    expect(rowsAvailable(grid)).toBeGreaterThan(5);
  });

  it('counts rows for the message, sign-off and P.S.', () => {
    expect(rowsNeeded({ copyLines: 4, signatureText: false, signatureImage: false, postscriptLines: 0 })).toBe(4);
    expect(rowsNeeded({ copyLines: 4, signatureText: true, signatureImage: false, postscriptLines: 1 })).toBe(7);
    expect(rowsNeeded({ copyLines: 4, signatureText: true, signatureImage: true, postscriptLines: 1 })).toBe(8);
    expect(rowsNeeded({ copyLines: 0, signatureText: false, signatureImage: false, postscriptLines: 0 })).toBe(1);
  });
});

describe('note length advice', () => {
  it('counts words, not stray punctuation', () => {
    expect(countWords('Hi Maya, saw the launch — loved it.')).toBe(7);
    expect(countWords('   ')).toBe(0);
  });

  it('warns and says how much to cut when the writing had to shrink', () => {
    const advice = noteAdvice(60, 50, { fontSize: 41, needed: 9, available: 9, chosen: { needed: 12, available: 9 } });
    expect(advice.tone).toBe('warn');
    expect(advice.text).toContain('shrinks to 41');
    expect(advice.text).toContain('Cut about 15 words');
  });

  it('praises a good length and explains growth on short notes', () => {
    expect(noteAdvice(30, 50, { fontSize: 50, needed: 6, available: 9, chosen: { needed: 6, available: 9 } }).tone).toBe('good');
    expect(noteAdvice(12, 50, { fontSize: 62, needed: 4, available: 7, chosen: { needed: 3, available: 9 } }).text).toContain('grows to 62');
    expect(noteAdvice(48, 50, null).tone).toBe('info');
  });
});
