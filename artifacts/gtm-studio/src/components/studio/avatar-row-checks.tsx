import { useEffect, useMemo, useState } from 'react';
import { rowsMissingPortrait } from '@/studio/avatar-fallback';
import { typedNoteOverflowRows } from '@/studio/renderer';
import { avatarRowWarnings, type RowRef } from '@/studio/row-checks';
import type { Contact, StudioConfig } from '@/studio/types';

/** Checking the letter fit costs a text measure per row, so very long lists are checked up to here. */
const FIT_CHECK_LIMIT = 2000;

/**
 * Avatar cards: rows with no portrait (they get an initials or site-icon badge) and rows whose letter
 * is cut off even at the smallest type size. Same look as the "rows read wrong" list beside it.
 */
export function AvatarRowChecks({
  config,
  contacts,
  configFor,
  onSelectRow,
}: {
  config: StudioConfig;
  contacts: Contact[];
  configFor: (contact: Contact) => StudioConfig;
  onSelectRow: (index: number) => void;
}) {
  const missing = useMemo(
    () => rowsMissingPortrait(config, contacts),
    [config.avatarColumn, config.avatarUrl, config.avatarImage, contacts], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const [overflowing, setOverflowing] = useState<RowRef[]>([]);
  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void typedNoteOverflowRows(contacts.slice(0, FIT_CHECK_LIMIT), configFor)
        .then((rows) => { if (!cancelled) setOverflowing(rows); })
        .catch(() => undefined);
    }, 400);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [contacts, configFor]);
  const warnings = avatarRowWarnings(missing, overflowing);
  if (!warnings.length) return null;
  const hint = [
    missing.length ? 'No portrait: the card shows the company’s site icon (when the row has a website) or the prospect’s initials, never another prospect’s face.' : '',
    overflowing.length ? 'Letter cut off: too long for the text frame even at the smallest type. Cut words or enlarge the frame.' : '',
  ].filter(Boolean).join(' ');
  return (
    <div className="load-error row-check" role="status" data-testid="avatar-row-checks">
      <p className="font-semibold">{warnings.length} of {contacts.length} {contacts.length === 1 ? 'card needs' : 'cards need'} a look</p>
      <p className="text-sm">{hint}</p>
      <ul className="mt-1 flex flex-wrap gap-1.5">
        {warnings.slice(0, 8).map((item) => (
          <li key={item.index}>
            <button type="button" className="tag-chip" onClick={() => onSelectRow(item.index)} title={`Show row ${item.row}`}>
              Row {item.row}: {item.problems.join(', ')}
            </button>
          </li>
        ))}
        {warnings.length > 8 && <li className="text-sm text-muted-foreground">and {warnings.length - 8} more</li>}
      </ul>
    </div>
  );
}
