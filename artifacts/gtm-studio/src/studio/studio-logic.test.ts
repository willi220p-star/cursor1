import { describe, expect, it } from 'vitest';
import { renderMerge, safeFilename, unresolvedTags } from './merge';
import { importProspectText } from './importers';
import { applyFieldMap, detectFieldMap } from './field-map';
import { exportListCsv, outputColumnNames, stampStudioOutputs } from './writeback';
import { checkRows, describeIssue } from './row-checks';
import { runQueue } from './batch-queue';
import { scrubText } from '@/lib/crash-reports';
import type { Contact, GeneratedAsset } from './types';

const maya: Contact = { row: 1, name: 'Maya Nguyen', company: 'Top End Solar', city: 'Darwin' };

describe('merge tags', () => {
  it('uses the first word of a full name for {first_name}', () => {
    expect(renderMerge('Hi {first_name},', maya)).toBe('Hi Maya,');
  });

  it('fills a known column and falls back when a value is missing', () => {
    expect(renderMerge('Loved what {company} is building', maya)).toBe('Loved what Top End Solar is building');
    expect(renderMerge('Hi {first_name|there}', { row: 2 })).toBe('Hi there');
  });

  it('reports tags that have no value and no fallback', () => {
    expect(unresolvedTags('{company} in {city}', { row: 3, city: 'Darwin' })).toEqual(['company']);
    expect(unresolvedTags('Hi {first_name|there}', { row: 3 })).toEqual([]);
  });

  it('makes safe file names', () => {
    const name = safeFilename('{company} note {row}', maya, 'png');
    expect(name).toBe('Top_End_Solar_note_1.png');
    expect(safeFilename('{missing}', { row: 9 }, 'gif')).toMatch(/\.gif$/);
  });
});

describe('importing a list', () => {
  const csv = 'Name,Company,Role,City,Image link,msg\nMaya Nguyen,Top End Solar,Director,Darwin,/avatars/maya.svg,Loved the launch\nEthan Ryder,Saltbush Studio,Founder,Palmerston,/avatars/ethan.svg,Nice work';

  it('reads rows and numbers them by spreadsheet line', () => {
    const list = importProspectText(csv);
    expect(list.rows).toHaveLength(2);
    expect(list.rows[0].row).toBe(2); // line 1 is the header row
    expect(list.rows[1].company).toBe('Saltbush Studio');
  });

  it('matches common headers to studio fields without asking', () => {
    const list = importProspectText(csv);
    const map = detectFieldMap(list.columns, list.rows);
    const use = Object.fromEntries(map.map((item) => [item.column, item.use]));
    expect(use.name).toBe('name');
    expect(use.company).toBe('company');
    expect(use.role).toBe('role');
    expect(use.city).toBe('city');
    expect(applyFieldMap(list.rows, map)).toHaveLength(2);
  });
});

describe('writing results back to the list', () => {
  const asset = (row: number, extra: Partial<GeneratedAsset> = {}): GeneratedAsset => ({
    id: `a${row}`, row, filename: `note_${row}.png`, blob: new Blob(), url: '', bytes: 10, selected: true, status: 'ready', ...extra,
  });

  it('stamps file, link and Smartlead columns on each row', () => {
    const rows: Contact[] = [maya, { row: 2, name: 'Ethan' }];
    const stamped = stampStudioOutputs(rows, [asset(1, { publicUrl: 'https://cdn.example/note_1.png', uploadStatus: 'uploaded' }), asset(2, { status: 'failed', error: 'No photo' })], 'handwritten');
    expect(stamped[0].handwritten_file).toBe('note_1.png');
    expect(stamped[0].smartlead_image_url).toBe('https://cdn.example/note_1.png');
    expect(stamped[0].handwritten_status).toBe('uploaded');
    expect(stamped[1].handwritten_file).toBe('');
    expect(stamped[1].handwritten_status).toBe('No photo');
  });

  it('exports the output columns in the CSV', () => {
    const stamped = stampStudioOutputs([maya], [asset(1)], 'memes');
    const { csv } = exportListCsv(stamped, { campaignName: 'Wesley Mission' }, 'memes');
    for (const column of outputColumnNames('memes')) expect(csv.split('\n')[0]).toContain(column);
  });
});

describe('import row checks', () => {
  it('names rows the copy cannot be filled for', () => {
    const issues = checkRows([maya, { row: 2, city: 'Darwin' }], 'Hi {first_name}, loved {company}');
    expect(issues).toHaveLength(1);
    expect(describeIssue(issues[0])).toBe('Row 2: no first name, no company');
  });

  it('flags image columns that are not links and bad emails', () => {
    const issues = checkRows([{ row: 4, name: 'Noah', image_link: 'noah photo', email: 'noah@' }], 'Hi {first_name}');
    expect(issues[0].problems).toEqual(['image link is not a web link', 'email address looks wrong']);
  });

  it('passes clean rows', () => {
    expect(checkRows([{ ...maya, image_link: 'https://img.example/m.jpg', email: 'maya@topend.com.au' }], 'Hi {first_name|there}')).toEqual([]);
  });
});

describe('batch queue', () => {
  it('never runs more than the lane limit and keeps input order', async () => {
    let running = 0;
    let peak = 0;
    const results = await runQueue([30, 10, 20, 5, 15], 2, async (ms, lane) => {
      running += 1;
      peak = Math.max(peak, running);
      expect(lane).toBeLessThan(2);
      await new Promise((resolve) => setTimeout(resolve, ms));
      running -= 1;
      return ms * 2;
    });
    expect(peak).toBe(2);
    expect(results).toEqual([60, 20, 40, 10, 30]);
  });

  it('starts nothing new after Stop, and keeps what finished', async () => {
    let stop = false;
    const results = await runQueue([1, 2, 3, 4], 1, async (value) => {
      if (value === 2) stop = true;
      return value;
    }, { shouldStop: () => stop });
    expect(results).toEqual([1, 2, undefined, undefined]);
  });
});

describe('safety helpers', () => {
  it('masks emails and phone numbers before a crash report is sent', () => {
    expect(scrubText('Upload failed for maya@topend.com.au, call +61 412 345 678')).toBe('Upload failed for [email], call [phone]');
  });

});
