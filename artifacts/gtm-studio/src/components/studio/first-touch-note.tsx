import { useState } from 'react';
import { Info, X } from 'lucide-react';
import type { CanvasSize } from '@/studio/types';

const DISMISS_KEY = 'gtm-first-touch-note-dismissed';

function readDismissed() {
  try {
    return localStorage.getItem(DISMISS_KEY) === '1';
  } catch {
    return false;
  }
}

/**
 * Advice only: an image plus a link in the very first cold email is a common spam-filter
 * trigger. Shown for studios whose output goes into email (anything not sized for LinkedIn).
 */
export function FirstTouchNote({ channel }: { channel: CanvasSize }) {
  const [dismissed, setDismissed] = useState(readDismissed);
  if (dismissed || channel === 'LinkedIn') return null;
  const dismiss = () => {
    setDismissed(true);
    try {
      localStorage.setItem(DISMISS_KEY, '1');
    } catch {
      // Private window or blocked storage: it stays hidden for this visit.
    }
  };
  return (
    <div className="ship-note" role="note" aria-label="First-touch deliverability">
      <Info size={16} aria-hidden />
      <div>
        <strong>Keep step 1 plain text</strong>
        <p>An image plus a link in the very first cold email is a common spam-filter trigger. Use the image in step 2 or 3 of the sequence, or on LinkedIn.</p>
      </div>
      <button type="button" className="ship-note-close" onClick={dismiss} aria-label="Dismiss first-touch advice">
        <X size={16} aria-hidden />
      </button>
    </div>
  );
}
