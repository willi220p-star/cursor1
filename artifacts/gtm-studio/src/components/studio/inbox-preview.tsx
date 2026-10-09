import { AlertTriangle, CheckCircle2, Eye, Info } from 'lucide-react';
import * as TabsPrimitive from '@radix-ui/react-tabs';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList } from '@/components/ui/tabs';
import { FieldRow, Section } from '@/components/studio/shared';
import { renderMerge } from '@/studio/merge';
import type { NoteFitInfo } from '@/studio/note-advice';
import { canvasToBlob, renderStudioCanvas } from '@/studio/renderer';
import {
  DEFAULT_EMAIL_PREVIEW,
  DEFAULT_EMAIL_SUBJECT,
  LEGIBLE_HANDWRITING_PX,
  LEGIBLE_TYPED_PX,
  checkSurfaces,
  inboxSurfaces,
  senderFromSignature,
  summarizeChecks,
  type FitFacts,
  type InboxSurfaceId,
  type SurfaceCheck,
  type TextKind,
} from '@/studio/inbox-check';
import { canvasSizes, isHandwritingDesk, type Contact, type StudioConfig, type StudioMode } from '@/studio/types';

type Props = {
  config: StudioConfig;
  contact: Contact;
  mode: StudioMode;
  /** The measured note fit for this row (handwriting studios), from the generator. */
  noteFit: NoteFitInfo | null;
  /** Words in this row's note. */
  words: number;
  onConfigChange: <K extends keyof StudioConfig>(key: K, value: StudioConfig[K]) => void;
};

function textKind(mode: StudioMode): TextKind | null {
  if (isHandwritingDesk(mode)) return 'handwriting';
  if (mode === 'avatar') return 'typed';
  return null;
}

function fitFacts(kind: TextKind | null, config: StudioConfig, noteFit: NoteFitInfo | null, words: number): FitFacts | null {
  if (kind === 'handwriting') {
    return noteFit
      ? { usedSize: noteFit.fontSize, chosenSize: config.fontSize, needed: noteFit.needed, available: noteFit.available, words, fontScale: noteFit.fontScale }
      : { usedSize: config.fontSize, chosenSize: config.fontSize, words };
  }
  // Avatar cards never draw typed text below 14 px on the canvas.
  if (kind === 'typed') return { usedSize: Math.max(14, config.fontSize), chosenSize: config.fontSize };
  return null;
}

/** Inbox preview section for the Ship tab: a one-line legibility summary and the mockup dialog. */
export function InboxPreviewSection({ config, contact, mode, noteFit, words, onConfigChange }: Props) {
  const [open, setOpen] = useState(false);
  const canvas = canvasSizes[config.channel] ?? canvasSizes.LinkedIn;
  const kind = textKind(mode);
  const checks = useMemo(
    () => checkSurfaces(kind, fitFacts(kind, config, noteFit, words), canvas),
    [kind, config, noteFit, words, canvas],
  );
  const summary = summarizeChecks(checks);
  const allGood = summary ? summary.readable === summary.total : true;

  return (
    <Section title="Inbox preview" hint="See this row's image at the size it shows in an inbox before you generate the batch.">
      <p className="inbox-summary" data-tone={summary ? (allGood ? 'good' : 'warn') : 'info'} role="status">
        {summary ? (allGood ? <CheckCircle2 size={16} aria-hidden /> : <AlertTriangle size={16} aria-hidden />) : <Info size={16} aria-hidden />}
        <span>{summary?.text ?? 'Shows the image in email and DM mockups. Check captions by eye.'}</span>
      </p>
      <button type="button" className="btn btn-quiet w-full" onClick={() => setOpen(true)}>
        <Eye size={16} aria-hidden /> Open inbox preview
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="inbox-dialog flex max-h-[92dvh] w-[min(920px,calc(100vw-24px))] max-w-none flex-col gap-4 overflow-y-auto overflow-x-hidden rounded-[12px] border-border bg-card p-4 shadow-[var(--shadow-overlay)] sm:max-w-none sm:p-6 [&>button]:right-3 [&>button]:top-3 [&>button]:h-11 [&>button]:w-11 [&>button]:rounded-md [&>button]:opacity-100 [&>button>svg]:mx-auto [&>button>svg]:h-5 [&>button>svg]:w-5">
          {open && (
            <InboxPreviewBody
              config={config}
              contact={contact}
              kind={kind}
              checks={checks}
              summaryText={summary?.text ?? null}
              onConfigChange={onConfigChange}
            />
          )}
        </DialogContent>
      </Dialog>
    </Section>
  );
}

/** Same config object unless something other than the inbox copy changed, so typing a subject does not re-render the image. */
function useImageConfig(config: StudioConfig) {
  const last = useRef(config);
  const prev = last.current;
  if (prev !== config) {
    const keys = new Set([...Object.keys(prev), ...Object.keys(config)]) as Set<keyof StudioConfig>;
    keys.delete('emailSubject');
    keys.delete('emailPreview');
    for (const key of keys) {
      if (prev[key] !== config[key]) {
        last.current = config;
        break;
      }
    }
  }
  return last.current;
}

/** Renders this row's final still frame at full size, debounced. Mounted only while the dialog is open. */
function useRenderedImage(config: StudioConfig, contact: Contact) {
  const imageConfig = useImageConfig(config);
  const [state, setState] = useState<{ url: string | null; busy: boolean; error: boolean }>({ url: null, busy: true, error: false });
  const urlRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setState((current) => ({ ...current, busy: true }));
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const canvas = await renderStudioCanvas(imageConfig, contact, 1, 1);
          if (cancelled) return;
          const blob = await canvasToBlob(canvas, 'image/jpeg', 0.9);
          if (cancelled) return;
          const url = URL.createObjectURL(blob);
          if (urlRef.current) URL.revokeObjectURL(urlRef.current);
          urlRef.current = url;
          setState({ url, busy: false, error: false });
        } catch {
          if (!cancelled) setState((current) => ({ ...current, busy: false, error: true }));
        }
      })();
    }, 300);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [imageConfig, contact]);

  useEffect(() => () => {
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    urlRef.current = null;
  }, []);

  return state;
}

function recipientName(contact: Contact) {
  const full = String(contact.name || contact.full_name || '').trim();
  const first = String(contact.first_name || '').trim();
  const last = String(contact.last_name || '').trim();
  return full || [first, last].filter(Boolean).join(' ') || String(contact.company || `Row ${contact.row}`);
}

function initial(name: string) {
  return (name.trim()[0] ?? '?').toUpperCase();
}

function InboxPreviewBody({
  config,
  contact,
  kind,
  checks,
  summaryText,
  onConfigChange,
}: {
  config: StudioConfig;
  contact: Contact;
  kind: TextKind | null;
  checks: SurfaceCheck[];
  summaryText: string | null;
  onConfigChange: Props['onConfigChange'];
}) {
  const [tab, setTab] = useState<InboxSurfaceId>('email-desktop');
  const image = useRenderedImage(config, contact);
  const canvas = canvasSizes[config.channel] ?? canvasSizes.LinkedIn;
  const subjectTemplate = config.emailSubject ?? DEFAULT_EMAIL_SUBJECT;
  const previewTemplate = config.emailPreview ?? DEFAULT_EMAIL_PREVIEW;
  const copy = {
    sender: senderFromSignature(config.signature ? renderMerge(config.signature, contact) : ''),
    recipient: recipientName(contact),
    subject: renderMerge(subjectTemplate, contact).trim() || '(no subject)',
    preview: renderMerge(previewTemplate, contact).trim(),
  };

  return (
    <>
      <DialogHeader className="pr-12 text-left">
        <DialogTitle className="display text-2xl font-semibold">Inbox preview</DialogTitle>
        <DialogDescription className="text-sm">
          Row {contact.row} · {copy.recipient}. Each mockup shows the image at the width that inbox displays it.
          {summaryText ? ` ${summaryText}` : ''}
        </DialogDescription>
      </DialogHeader>

      <div className="inbox-fields">
        <FieldRow id="inbox-subject" label="Email subject">
          <input
            id="inbox-subject"
            className="field"
            value={subjectTemplate}
            onChange={(event) => onConfigChange('emailSubject', event.target.value)}
          />
        </FieldRow>
        <FieldRow id="inbox-first-line" label="First line of the email">
          <input
            id="inbox-first-line"
            className="field"
            value={previewTemplate}
            onChange={(event) => onConfigChange('emailPreview', event.target.value)}
          />
        </FieldRow>
      </div>

      <Tabs value={tab} onValueChange={(value) => setTab(value as InboxSurfaceId)} className="flex min-w-0 flex-col gap-4">
        <TabsList className="inbox-tabs" aria-label="Inbox mockup">
          {checks.map((check) => (
            <TabsPrimitive.Trigger key={check.surface.id} value={check.surface.id} className="inbox-tab">
              <span>{check.surface.label}</span>
              {check.verdict && (
                <span className="inbox-badge" data-verdict={check.verdict}>{check.verdict === 'ok' ? 'OK' : 'Small'}</span>
              )}
            </TabsPrimitive.Trigger>
          ))}
        </TabsList>
        {checks.map((check) => (
          <TabsContent key={check.surface.id} value={check.surface.id} className="mt-0 flex min-w-0 flex-col gap-3 focus-visible:outline-none">
            <VerdictPanel check={check} kind={kind} onConfigChange={onConfigChange} />
            <FitStage naturalWidth={frameWidth(check.surface.id)} shownWidth={check.shownWidth}>
              <Mockup
                id={check.surface.id}
                copy={copy}
                image={
                  <InboxImage
                    url={image.url}
                    busy={image.busy}
                    error={image.error}
                    width={check.shownWidth}
                    height={Math.round((check.shownWidth * canvas.height) / canvas.width)}
                  />
                }
              />
            </FitStage>
          </TabsContent>
        ))}
      </Tabs>
    </>
  );
}

function VerdictPanel({ check, kind, onConfigChange }: { check: SurfaceCheck; kind: TextKind | null; onConfigChange: Props['onConfigChange'] }) {
  if (!check.verdict || check.effective === null || check.xHeight === null) {
    return (
      <div className="inbox-verdict" data-verdict="none">
        <Info size={16} aria-hidden />
        <p>Shown {check.shownWidth} px wide. The size check covers handwriting and avatar text; read the captions here by eye.</p>
      </div>
    );
  }
  const threshold = kind === 'handwriting' ? LEGIBLE_HANDWRITING_PX : LEGIBLE_TYPED_PX;
  const what = kind === 'handwriting' ? 'Writing' : 'Text';
  const ok = check.verdict === 'ok';
  const action = check.fix?.action;
  return (
    <div className="inbox-verdict" data-verdict={check.verdict}>
      {ok ? <CheckCircle2 size={16} aria-hidden /> : <AlertTriangle size={16} aria-hidden />}
      <div className="min-w-0 flex-1">
        <p>
          <strong>{ok ? 'OK' : 'Hard to read'}.</strong>{' '}
          Shown {check.shownWidth} px wide, so the {what.toLowerCase()} is about {Math.round(check.effective)} px
          {' '}(letters ~{Math.round(check.xHeight)} px tall). Readable from {threshold} px.
        </p>
        {check.fix && <p className="mt-1"><strong>Fix:</strong> {check.fix.text}</p>}
      </div>
      {action && (
        <button type="button" className="btn btn-quiet btn-sm flex-none" onClick={() => onConfigChange(action.key, action.value)}>
          Set size {action.value}
        </button>
      )}
    </div>
  );
}

/** Natural width of each mockup frame, in CSS px. */
function frameWidth(id: InboxSurfaceId) {
  if (id === 'email-phone') return 360;
  if (id === 'dm') return 420;
  return 720;
}

/** Shows the frame at real size when it fits, otherwise scales it down and says so. */
function FitStage({ naturalWidth, shownWidth, children }: { naturalWidth: number; shownWidth: number; children: ReactNode }) {
  const outer = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [height, setHeight] = useState<number | undefined>(undefined);

  useLayoutEffect(() => {
    const box = outer.current;
    const frame = inner.current;
    if (!box || !frame) return;
    const measure = () => {
      const next = Math.min(1, box.clientWidth / naturalWidth);
      setScale(next);
      setHeight(frame.offsetHeight * next);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(box);
    observer.observe(frame);
    return () => observer.disconnect();
  }, [naturalWidth]);

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div ref={outer} className="inbox-stage" style={{ height }}>
        <div ref={inner} className="inbox-stage-inner" style={{ width: naturalWidth, transform: scale < 1 ? `scale(${scale})` : undefined }}>
          {children}
        </div>
      </div>
      {scale < 0.995 && (
        <p className="helper">Scaled to {Math.round(scale * 100)}% to fit this window. In the inbox the image is {shownWidth} px wide.</p>
      )}
    </div>
  );
}

function InboxImage({ url, busy, error, width, height }: { url: string | null; busy: boolean; error: boolean; width: number; height: number }) {
  if (!url) {
    return (
      <div className="inbox-image-placeholder" style={{ width, height }} role="status">
        {error ? 'Could not render this row.' : 'Rendering this row…'}
      </div>
    );
  }
  return (
    <img
      src={url}
      width={width}
      height={height}
      className="inbox-image"
      style={{ width, height }}
      data-busy={busy || undefined}
      alt="This row's image at inbox size"
    />
  );
}

type MockCopy = { sender: string; recipient: string; subject: string; preview: string };

function Mockup({ id, copy, image }: { id: InboxSurfaceId; copy: MockCopy; image: ReactNode }) {
  if (id === 'email-phone') {
    return (
      <div className="mock mock-phone" aria-label="Phone email mockup">
        <div className="mock-phone-status"><span>9:41</span><span aria-hidden>●●●</span></div>
        <div className="mock-phone-bar"><span>‹ Inbox</span><span className="mock-muted">Archive · More</span></div>
        <div className="mock-phone-body">
          <p className="mock-subject">{copy.subject}</p>
          <div className="mock-sender">
            <span className="mock-avatar" aria-hidden>{initial(copy.sender)}</span>
            <span className="min-w-0">
              <span className="mock-name">{copy.sender}</span>
              <span className="mock-muted block truncate">to {copy.recipient} · 9:30 AM</span>
            </span>
          </div>
          {copy.preview && <p className="mock-text">{copy.preview}</p>}
          {image}
          <div className="mock-actions"><span>Reply</span><span>Forward</span></div>
        </div>
      </div>
    );
  }
  if (id === 'outlook') {
    return (
      <div className="mock mock-outlook" aria-label="Outlook-style reading pane mockup">
        <div className="mock-ribbon"><span>New mail</span><span>Delete</span><span>Archive</span><span>Reply</span><span>Forward</span></div>
        <div className="mock-outlook-pane">
          <p className="mock-subject">{copy.subject}</p>
          <div className="mock-sender">
            <span className="mock-avatar is-square" aria-hidden>{initial(copy.sender)}</span>
            <span className="min-w-0 flex-1">
              <span className="mock-name">{copy.sender}</span>
              <span className="mock-muted block truncate">To: {copy.recipient}</span>
            </span>
            <span className="mock-muted">Tue 9:30 AM</span>
          </div>
          <div className="mock-indent">
            {copy.preview && <p className="mock-text">{copy.preview}</p>}
            {image}
          </div>
        </div>
      </div>
    );
  }
  if (id === 'dm') {
    return (
      <div className="mock mock-dm" aria-label="LinkedIn-style direct message mockup">
        <div className="mock-dm-head">
          <span className="mock-avatar" aria-hidden>{initial(copy.sender)}</span>
          <span className="min-w-0">
            <span className="mock-name">{copy.sender}</span>
            <span className="mock-muted block">Messaging</span>
          </span>
        </div>
        <div className="mock-dm-thread">
          <p className="mock-muted mock-dm-day">Today</p>
          <div className="mock-dm-message">
            <span className="mock-avatar is-small" aria-hidden>{initial(copy.sender)}</span>
            <div className="min-w-0">
              <p className="mock-name">{copy.sender} <span className="mock-muted">· 9:30 AM</span></p>
              {copy.preview && <p className="mock-text">{copy.preview}</p>}
              <div className="mock-dm-image">{image}</div>
            </div>
          </div>
        </div>
        <div className="mock-dm-compose">Write a message…</div>
      </div>
    );
  }
  return (
    <div className="mock mock-desktop" aria-label="Desktop email mockup">
      <div className="mock-desktop-bar"><span className="mock-search">Search mail</span></div>
      <div className="mock-desktop-pane">
        <p className="mock-subject">{copy.subject} <span className="mock-chip">Inbox</span></p>
        <div className="mock-sender">
          <span className="mock-avatar" aria-hidden>{initial(copy.sender)}</span>
          <span className="min-w-0 flex-1">
            <span className="mock-name">{copy.sender}</span>
            <span className="mock-muted block truncate">to {copy.recipient}</span>
          </span>
          <span className="mock-muted">9:30 AM</span>
        </div>
        <div className="mock-indent">
          {copy.preview && <p className="mock-text">{copy.preview}</p>}
          {image}
          <div className="mock-actions"><span>Reply</span><span>Forward</span></div>
        </div>
      </div>
    </div>
  );
}
