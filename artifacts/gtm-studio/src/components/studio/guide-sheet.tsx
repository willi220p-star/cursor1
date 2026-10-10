import { useState } from 'react';
import { HelpCircle } from 'lucide-react';
import { Sheet, SheetContent, SheetDescription, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { GUIDE_RELEASE, GUIDE_SEEN_KEY, guideContent, whatsNewFor, type GuideKey } from '@/studio/guide-content';

function readSeen() {
  try {
    return localStorage.getItem(GUIDE_SEEN_KEY) === GUIDE_RELEASE;
  } catch {
    return true;
  }
}

function markSeen() {
  try {
    localStorage.setItem(GUIDE_SEEN_KEY, GUIDE_RELEASE);
  } catch {
    // Storage blocked: the dot just shows again next time.
  }
}

/** "?" button plus the "How it works" sheet for one studio or the Desk. */
export function GuideButton({ guideKey, withLabel = false }: { guideKey: GuideKey; withLabel?: boolean }) {
  const [open, setOpen] = useState(false);
  const [seen, setSeen] = useState(readSeen);
  const entry = guideContent[guideKey];
  const news = whatsNewFor(guideKey);

  const onOpenChange = (next: boolean) => {
    setOpen(next);
    if (next && !seen) {
      markSeen();
      setSeen(true);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetTrigger asChild>
        <button
          type="button"
          className={`btn btn-quiet guide-button ${withLabel ? '' : 'btn-icon'}`}
          aria-label={withLabel ? undefined : seen ? 'How it works' : 'How it works, with new features'}
          title="How it works"
          data-testid="guide-button"
        >
          <HelpCircle size={18} aria-hidden />
          {withLabel && <span>How it works{seen ? '' : <span className="sr-only">, with new features</span>}</span>}
          {!seen && <span className="guide-dot" data-testid="guide-dot" aria-hidden />}
        </button>
      </SheetTrigger>
      <SheetContent
        side="right"
        data-testid="guide-sheet"
        className="guide-sheet flex w-full flex-col gap-0 overflow-y-auto border-border bg-card p-0 shadow-[var(--shadow-overlay)] sm:max-w-md [&>button]:right-3 [&>button]:top-3 [&>button]:h-11 [&>button]:w-11 [&>button]:rounded-md [&>button]:opacity-100 [&>button>svg]:mx-auto [&>button>svg]:h-5 [&>button>svg]:w-5"
      >
        <div className="guide-head">
          <SheetTitle className="display text-2xl font-semibold">{entry.heading}</SheetTitle>
          <SheetDescription className="text-base text-muted-foreground">{entry.intro}</SheetDescription>
        </div>
        <section className="guide-section" aria-labelledby="guide-steps">
          <h3 id="guide-steps">Steps</h3>
          <ol className="guide-steps">
            {entry.steps.map((step, index) => (
              <li key={step.title}>
                <span className="guide-step-number" aria-hidden>{index + 1}</span>
                <div>
                  <strong>{step.title}</strong>
                  <p>{step.body}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>
        <section className="guide-section" aria-labelledby="guide-tips">
          <h3 id="guide-tips">Outbound tips</h3>
          <ul className="guide-tips">
            {entry.tips.map((tip) => (
              <li key={tip.title}>
                <strong>{tip.title}</strong>
                <p>{tip.body}</p>
              </li>
            ))}
          </ul>
        </section>
        {news.length > 0 && (
          <section className="guide-section" aria-labelledby="guide-new">
            <h3 id="guide-new">What’s new</h3>
            <ul className="guide-news">
              {news.map((item) => <li key={item.text}>{item.text}</li>)}
            </ul>
          </section>
        )}
      </SheetContent>
    </Sheet>
  );
}
