import { describe, expect, it } from 'vitest';
import { baselineAt, buildRuleGrid, rowsAvailable, rowsNeeded, ruleStep } from './note-layout';

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
