import { describe, expect, it } from 'vitest';
import type { AppNotification, Review } from './contracts';
import {
  badgeText,
  CAMPAIGN_KEY,
  commentCounts,
  displayName,
  groupNotifications,
  latestAssetPerContact,
  latestReviews,
  notificationLabel,
  reviewHref,
  signoffWarning,
  summarizeCampaigns,
  summarizeReviews,
  summaryLabel,
  validateComment,
  validateNote,
  type AssetRef,
} from './review-logic';

const review = (id: string, asset_id: string | null, status: Review['status'], created_at: string, campaign_id = 'c1'): Review => ({
  id, space_id: 's1', campaign_id, asset_id, status, note: null, reviewer: 'u1', created_at,
});

const asset = (id: string, contact_key: string | null, created_at = '2026-10-01T00:00:00Z', campaign_id = 'c1'): AssetRef => ({
  id, campaign_id, contact_key, public_url: `https://x/${id}.png`, created_at,
});

describe('latestReviews', () => {
  it('keeps the newest row per asset, with the campaign sign-off under its own key', () => {
    const current = latestReviews([
      review('r1', 'a1', 'approved', '2026-10-01T10:00:00Z'),
      review('r2', 'a1', 'changes_requested', '2026-10-02T10:00:00Z'),
      review('r3', 'a2', 'approved', '2026-10-01T10:00:00Z'),
      review('r4', null, 'approved', '2026-10-03T10:00:00Z'),
    ]);
    expect(current.get('a1')?.id).toBe('r2');
    expect(current.get('a2')?.status).toBe('approved');
    expect(current.get(CAMPAIGN_KEY)?.id).toBe('r4');
  });

  it('is order independent for different times, and lets the later row win a tie', () => {
    const older = review('r1', 'a1', 'approved', '2026-10-01T10:00:00Z');
    const newer = review('r2', 'a1', 'changes_requested', '2026-10-05T10:00:00Z');
    expect(latestReviews([newer, older]).get('a1')?.id).toBe('r2');
    const tie = review('r3', 'a1', 'approved', '2026-10-05T10:00:00Z');
    expect(latestReviews([newer, tie]).get('a1')?.id).toBe('r3');
  });
});

describe('summaries', () => {
  it('counts one image per contact (the newest file) and only its current review', () => {
    const assets = [asset('a1', '2'), asset('a1-new', '2', '2026-10-05T00:00:00Z'), asset('a2', '3'), asset('a3', '4'), asset('loose', null)];
    expect(latestAssetPerContact(assets).map((item) => item.id).sort()).toEqual(['a1-new', 'a2', 'a3', 'loose']);
    const summary = summarizeReviews(assets, [
      review('r1', 'a1', 'approved', '2026-10-01T00:00:00Z'), // old file: does not count
      review('r2', 'a1-new', 'approved', '2026-10-06T00:00:00Z'),
      review('r3', 'a2', 'approved', '2026-10-06T00:00:00Z'),
      review('r4', 'a2', 'changes_requested', '2026-10-07T00:00:00Z'),
      review('r5', 'a3', 'approved', '2026-10-06T00:00:00Z'),
    ]);
    expect(summary).toMatchObject({ approved: 2, changesRequested: 1, total: 4, signedOff: null });
  });

  it('reports the sign-off only while the latest campaign review is an approval', () => {
    const assets = [asset('a1', '2')];
    const signed = summarizeReviews(assets, [review('s1', null, 'approved', '2026-10-01T00:00:00Z')]);
    expect(signed.signedOff?.id).toBe('s1');
    const reopened = summarizeReviews(assets, [
      review('s1', null, 'approved', '2026-10-01T00:00:00Z'),
      review('s2', null, 'changes_requested', '2026-10-02T00:00:00Z'),
    ]);
    expect(reopened.signedOff).toBeNull();
  });

  it('splits many campaigns from one aggregated result, zero for campaigns with nothing', () => {
    const map = summarizeCampaigns(
      ['c1', 'c2', 'c3'],
      [asset('a1', '2'), asset('b1', '2', undefined, 'c2'), asset('b2', '3', undefined, 'c2')],
      [review('r1', 'a1', 'approved', '2026-10-01T00:00:00Z'), review('r2', 'b1', 'approved', '2026-10-01T00:00:00Z', 'c2')],
    );
    expect(summaryLabel(map.get('c1')!)).toBe('1/1 approved');
    expect(summaryLabel(map.get('c2')!)).toBe('1/2 approved');
    expect(map.get('c3')).toEqual({ approved: 0, changesRequested: 0, total: 0, signedOff: null });
  });

  it('formats big numbers in the label', () => {
    expect(summaryLabel({ approved: 1200, total: 1500 })).toBe('1,200/1,500 approved');
  });
});

describe('copy and validation', () => {
  it('warns before signing off with open change requests', () => {
    expect(signoffWarning(0)).toBeNull();
    expect(signoffWarning(1)).toBe('1 image still needs changes — sign off anyway?');
    expect(signoffWarning(3)).toBe('3 images still need changes — sign off anyway?');
  });

  it('caps the badge at 99+', () => {
    expect(badgeText(0)).toBe('');
    expect(badgeText(7)).toBe('7');
    expect(badgeText(99)).toBe('99');
    expect(badgeText(100)).toBe('99+');
  });

  it('requires a short note and a non-empty comment', () => {
    expect(validateNote('  ')).toMatch(/Add a note/);
    expect(validateNote('x'.repeat(501))).toMatch(/500/);
    expect(validateNote('Logo is blurry')).toBeNull();
    expect(validateComment('')).toMatch(/Write a comment/);
    expect(validateComment('x'.repeat(4001))).toMatch(/4,000/);
    expect(validateComment('Looks good')).toBeNull();
  });

  it('names people by display name, then email, then a fallback', () => {
    expect(displayName({ display_name: 'Sam Lee', email: 'sam@x.com' })).toBe('Sam Lee');
    expect(displayName({ display_name: ' ', email: 'sam@x.com' })).toBe('sam');
    expect(displayName(null)).toBe('Someone');
  });

  it('counts live comments per thread', () => {
    const counts = commentCounts([
      { asset_id: null, deleted_at: null },
      { asset_id: 'a1', deleted_at: null },
      { asset_id: 'a1', deleted_at: null },
      { asset_id: 'a1', deleted_at: '2026-10-01T00:00:00Z' },
    ]);
    expect(counts.get(CAMPAIGN_KEY)).toBe(1);
    expect(counts.get('a1')).toBe(2);
  });
});

describe('notifications', () => {
  const note = (id: string, extra: Partial<AppNotification>): AppNotification => ({
    id, recipient: 'me', kind: 'approved', space_id: 's1', campaign_id: 'c1', asset_id: null, actor: 'sam', summary: 'Sam approved an image', created_at: '2026-10-17T10:00:00Z', read_at: null, ...extra,
  });

  it('groups the same actor, action and campaign within an hour, newest first', () => {
    const groups = groupNotifications([
      note('n1', { asset_id: 'a1', created_at: '2026-10-17T10:00:00Z' }),
      note('n2', { asset_id: 'a2', created_at: '2026-10-17T10:20:00Z', read_at: '2026-10-17T10:30:00Z' }),
      note('n3', { asset_id: 'a3', created_at: '2026-10-17T10:40:00Z' }),
      note('n4', { kind: 'commented', created_at: '2026-10-17T10:50:00Z' }),
      note('n5', { asset_id: 'a9', created_at: '2026-10-17T08:00:00Z' }),
      note('n6', { asset_id: 'a1', campaign_id: 'c2', created_at: '2026-10-17T10:10:00Z' }),
    ]);
    expect(groups.map((group) => group.ids)).toEqual([['n4'], ['n3', 'n2', 'n1'], ['n6'], ['n5']]);
    expect(groups[1]).toMatchObject({ assetCount: 3, count: 3, unread: true, created_at: '2026-10-17T10:40:00Z' });
  });

  it('marks a group read only when every row is read', () => {
    const [group] = groupNotifications([
      note('n1', { asset_id: 'a1', read_at: '2026-10-17T11:00:00Z' }),
      note('n2', { asset_id: 'a2', created_at: '2026-10-17T10:05:00Z', read_at: '2026-10-17T11:00:00Z' }),
    ]);
    expect(group.unread).toBe(false);
  });

  it('labels groups in plain English', () => {
    const names = { actor: 'Sam', campaign: 'Acme Q4' };
    const label = (kind: AppNotification['kind'], assetCount: number, count = 1) => notificationLabel({ kind, assetCount, count, summary: 'fallback' }, names);
    expect(label('approved', 3)).toBe('Sam approved 3 images in Acme Q4');
    expect(label('approved', 1)).toBe('Sam approved 1 image in Acme Q4');
    expect(label('changes_requested', 2)).toBe('Sam requested changes on 2 images in Acme Q4');
    expect(label('changes_requested', 0)).toBe('Sam requested changes on Acme Q4');
    expect(label('signed_off', 0)).toBe('Sam signed off Acme Q4');
    expect(label('commented', 0)).toBe('Sam commented on Acme Q4');
    expect(label('commented', 0, 4)).toBe('Sam left 4 comments on Acme Q4');
    expect(label('review_requested', 0)).toBe('Sam asked you to review Acme Q4');
  });

  it('falls back to the trigger summary without a campaign name', () => {
    expect(notificationLabel({ kind: 'approved', assetCount: 2, count: 2, summary: 'Sam approved 2 images' }, { actor: 'Sam' })).toBe('Sam approved 2 images');
  });

  it('links to the Desk with the campaign in the query', () => {
    expect(reviewHref('c 1')).toBe('/?campaign=c%201');
  });
});
