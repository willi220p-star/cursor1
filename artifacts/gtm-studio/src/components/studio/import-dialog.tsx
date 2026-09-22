import { useEffect, useMemo, useState, type ChangeEvent, type DragEvent, type ReactNode } from 'react';
import { ArrowLeft, ArrowRight, Check, CircleAlert, ClipboardPaste, FileSpreadsheet, Sparkles, TriangleAlert } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Checkbox } from '@/components/ui/checkbox';
import { useMediaQuery } from '@/hooks/use-media-query';
import { loadSampleList } from '@/studio/activity';
import {
  applyFieldMap,
  assignmentLabel,
  columnForField,
  detectFieldMap,
  visibleAssignments,
  type FieldAssignment,
} from '@/studio/field-map';
import { contactColumns, importProspectFile, importProspectText, type ImportedList } from '@/studio/importers';
import { unresolvedTags } from '@/studio/merge';
import { studioModes, type Contact, type StudioMode } from '@/studio/types';
import { DurablePortrait } from './shared';

export type ImportResult = {
  rows: Contact[];
  source: string;
  sourceColumns: string[];
  sourceFile?: File;
  avatarColumn?: string;
  messageColumn?: string;
  destinations: StudioMode[];
  fieldMap: FieldAssignment[];
};
export type ImportStep = 'source' | 'review';

function explainParseError(message: string, fileName?: string) {
  const where = fileName ? `${fileName}: ` : '';
  if (/duplicate columns/i.test(message)) return `${where}${message} Rename one of them in the spreadsheet, then import again.`;
  if (/needs a header/i.test(message)) return `${where}${message} The first row must name every column — remove blank header cells.`;
  if (/too (few|many) fields/i.test(message)) return `${where}${message} Check that row for stray commas or unclosed quotes.`;
  if (/no prospect rows/i.test(message)) return `${where}${message} The sheet needs a header row and at least one row of data.`;
  return `${where}${message}`;
}

function Stepper({ step }: { step: ImportStep }) {
  const steps: { id: ImportStep; label: string }[] = [
    { id: 'source', label: 'File and studio' },
    { id: 'review', label: 'Matched fields' },
  ];
  const index = steps.findIndex((item) => item.id === step);
  return (
    <ol className="flex flex-wrap items-center gap-2" aria-label="Import steps">
      {steps.map((item, i) => (
        <li key={item.id} className={`step-pill ${i === index ? 'is-active' : ''} ${i < index ? 'is-done' : ''}`} aria-current={i === index ? 'step' : undefined}>
          <span className="num">{i < index ? <Check size={14} aria-hidden /> : i + 1}</span>
          {item.label}
        </li>
      ))}
    </ol>
  );
}

function DestinationPicker({
  currentMode,
  destinations,
  onToggle,
}: {
  currentMode: StudioMode;
  destinations: StudioMode[];
  onToggle: (mode: StudioMode, checked: boolean) => void;
}) {
  return (
    <div>
      <p className="label">Use this list in</p>
      <p className="helper mb-3">Choose handwritten notes, avatar cards, moving memes, or GIF. After save, that studio opens so you can make a template for every row.</p>
      <div className="grid gap-2 sm:grid-cols-2">
        {studioModes.map((studio) => {
          const checked = destinations.includes(studio.id);
          return (
            <label key={studio.id} className={`toggle-row ${studio.id === currentMode ? 'border-primary' : ''}`}>
              <Checkbox
                className="h-5 w-5 rounded-[4px] border-input"
                checked={checked}
                onCheckedChange={(value) => onToggle(studio.id, value === true)}
              />
              <span>
                <strong className="block text-sm font-semibold">{studio.label}</strong>
                <small className="text-muted-foreground">{studio.id === currentMode ? 'This desk' : studio.hint}</small>
              </span>
            </label>
          );
        })}
      </div>
    </div>
  );
}

export function ImportDialog({
  open,
  onOpenChange,
  initialStep = 'source',
  currentMode,
  currentContacts,
  savedMap,
  copyForTags,
  onImport,
  onInsertTag,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialStep?: ImportStep | 'map' | 'confirm';
  currentMode: StudioMode;
  currentContacts: Contact[];
  savedMap?: FieldAssignment[];
  copyForTags: string;
  onImport: (result: ImportResult) => void;
  onInsertTag: (tag: string) => void;
}) {
  const desktop = useMediaQuery('(min-width: 1024px)');
  const [step, setStep] = useState<ImportStep>('source');
  const [draft, setDraft] = useState<Contact[] | null>(null);
  const [draftSource, setDraftSource] = useState('');
  const [sourceColumns, setSourceColumns] = useState<string[]>([]);
  const [map, setMap] = useState<FieldAssignment[]>([]);
  const [parseError, setParseError] = useState('');
  const [busy, setBusy] = useState(false);
  const [dragover, setDragover] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [destinations, setDestinations] = useState<StudioMode[]>([currentMode]);
  const [sourceFile, setSourceFile] = useState<File | undefined>();

  const wantsReview = initialStep !== 'source';

  useEffect(() => {
    if (!open) return;
    setParseError('');
    setBusy(false);
    setDestinations([currentMode]);
    if (wantsReview && currentContacts.length) {
      setDraft(currentContacts);
      setDraftSource('current list');
      const nextColumns = contactColumns(currentContacts);
      const reused = savedMap?.length && savedMap.every((item) => nextColumns.includes(item.column) || item.column === 'first_name')
        ? savedMap.filter((item) => nextColumns.includes(item.column))
        : detectFieldMap(nextColumns, currentContacts);
      setSourceColumns(nextColumns);
      setMap(reused);
      setStep('review');
    } else {
      setDraft(null);
      setMap([]);
      setSourceColumns([]);
      setSourceFile(undefined);
      setStep('source');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const columns = useMemo(
    () => (sourceColumns.length ? sourceColumns : (draft ? contactColumns(draft) : [])),
    [draft, sourceColumns],
  );
  const mapped = useMemo(() => (draft ? applyFieldMap(draft, map) : []), [draft, map]);
  const shown = useMemo(() => visibleAssignments(map), [map]);
  const matched = shown.filter((item) => item.use !== 'custom');
  const customs = shown.filter((item) => item.use === 'custom');
  const mappedColumns = shown.map((item) => (item.use === 'custom' ? (item.customTag || item.column) : item.column));
  const portraitColumn = columnForField(map, 'portrait');
  const messageColumn = columnForField(map, 'message');
  const unknownTags = useMemo(() => (mapped[0] ? [...new Set(unresolvedTags(copyForTags, mapped[0]))] : []), [mapped, copyForTags]);

  const acceptRows = (imported: ImportedList, source: string, file?: File) => {
    if (!imported.rows.length) throw new Error('No prospect rows were found.');
    const nextColumns = imported.columns.length ? imported.columns : contactColumns(imported.rows);
    setDraft(imported.rows);
    setDraftSource(source);
    setSourceColumns(nextColumns);
    setSourceFile(file);
    setMap(detectFieldMap(nextColumns, imported.rows));
    setParseError('');
    setStep('review');
  };

  const parseFile = async (file: File) => {
    setBusy(true);
    try {
      acceptRows(await importProspectFile(file), file.name, file);
    } catch (reason) {
      setParseError(explainParseError(reason instanceof Error ? reason.message : 'Import failed.', file.name));
    } finally {
      setBusy(false);
    }
  };

  const onFileInput = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (file) await parseFile(file);
  };

  const onDrop = async (event: DragEvent) => {
    event.preventDefault();
    setDragover(false);
    const file = event.dataTransfer.files?.[0];
    if (file) await parseFile(file);
  };

  const parsePaste = () => {
    try {
      const imported = importProspectText(pasteText);
      const csv = imported.columns.join(',') + '\n' + imported.rows.map((row) => imported.columns.map((column) => String(row[column] ?? '')).join(',')).join('\n');
      acceptRows(imported, 'pasted spreadsheet', new File([csv], 'pasted-spreadsheet.csv', { type: 'text/csv' }));
      setPasteText('');
    } catch (reason) {
      setParseError(explainParseError(reason instanceof Error ? reason.message : 'Paste import failed.'));
    }
  };

  const loadSample = async () => {
    setBusy(true);
    try {
      const imported = await loadSampleList();
      acceptRows(imported, 'messy-prospects.csv', new File(
        [imported.columns.join(',') + '\n' + imported.rows.map((row) => imported.columns.map((column) => String(row[column] ?? '')).join(',')).join('\n')],
        'messy-prospects.csv',
        { type: 'text/csv' },
      ));
    } catch (reason) {
      setParseError(explainParseError(reason instanceof Error ? reason.message : 'The sample list could not be loaded.'));
    } finally {
      setBusy(false);
    }
  };

  const toggleDestination = (mode: StudioMode, checked: boolean) => {
    setDestinations((current) => {
      const next = checked ? [...new Set([...current, mode])] : current.filter((item) => item !== mode);
      return next.length ? next : [currentMode];
    });
  };

  const confirm = () => {
    if (!draft) return;
    onImport({
      rows: mapped,
      source: draftSource,
      sourceColumns: columns,
      sourceFile,
      avatarColumn: portraitColumn,
      messageColumn,
      destinations: destinations.length ? destinations : [currentMode],
      fieldMap: map,
    });
    onOpenChange(false);
  };

  const mappedPreview = mapped[0];
  const previewColumns = shown.map((item) => item.column);
  const studioSummary = destinations.map((item) => studioModes.find((studio) => studio.id === item)?.label).join(', ');
  const openStudio = studioModes.find((studio) => studio.id === (destinations.includes(currentMode) ? currentMode : destinations[0]))?.label;

  const body = (
    <div className="flex min-h-0 flex-1 flex-col">
      <Stepper step={step} />

      <div className="mt-6 min-h-0 flex-1 overflow-y-auto pr-1">
      {step === 'source' && (
        <div className="flex flex-col gap-6">
          <DestinationPicker currentMode={currentMode} destinations={destinations} onToggle={toggleDestination} />
          <div className="grid gap-6 lg:grid-cols-[1.1fr_.9fr]">
            <div className="flex flex-col gap-4">
              <label
                className={`upload-zone ${dragover ? 'is-dragover' : ''}`}
                onDragOver={(event) => { event.preventDefault(); setDragover(true); }}
                onDragLeave={() => setDragover(false)}
                onDrop={onDrop}
              >
                <FileSpreadsheet size={32} aria-hidden />
                <strong>Drop CSV, XLSX, XLS or ODS</strong>
                <span>or browse · up to 15 MB · first 400 rows are generated</span>
                <input type="file" className="sr-only" accept=".csv,.xlsx,.xls,.ods,text/csv" onChange={onFileInput} disabled={busy} />
              </label>
              <button type="button" className="btn btn-ghost self-start" onClick={loadSample} disabled={busy} data-loading={busy || undefined}>
                <Sparkles size={16} aria-hidden /> Load sample list
              </button>
            </div>
            <div className="flex flex-col gap-2">
              <label className="label" htmlFor="paste-rows">Paste rows from Sheets or Excel</label>
              <textarea
                id="paste-rows"
                className="field mono min-h-[160px] text-base"
                rows={6}
                placeholder={'name\tcompany\timage_link\tmsg\nMaya\tTop End Solar\thttps://…/maya.jpg\tLoved the Darwin launch'}
                value={pasteText}
                onChange={(event) => setPasteText(event.target.value)}
              />
              <button type="button" className="btn btn-quiet self-start" onClick={parsePaste} disabled={!pasteText.trim()}>
                <ClipboardPaste size={16} aria-hidden /> Parse pasted rows
              </button>
            </div>
          </div>
          {parseError && (
            <Alert variant="destructive" className="border-destructive/40 bg-destructive/5">
              <CircleAlert size={16} aria-hidden />
              <AlertTitle>That list could not be read</AlertTitle>
              <AlertDescription>{parseError}</AlertDescription>
            </Alert>
          )}
        </div>
      )}

      {step === 'review' && draft && (
        <div className="flex min-h-0 flex-col gap-5">
          <DestinationPicker currentMode={currentMode} destinations={destinations} onToggle={toggleDestination} />

          <p className="helper">
            {draft.length} rows from <span className="mono text-foreground">{draftSource}</span>. Each spreadsheet column is already under a studio field — there is nothing to choose.
          </p>

          <div className="grid gap-3 sm:grid-cols-3">
            <div className="dash-stat"><span>Rows</span><strong>{mapped.length}</strong><small>{mapped.length > 400 ? 'First 400 generate per batch' : 'All generate in one batch'}</small></div>
            <div className="dash-stat"><span>Matched fields</span><strong>{matched.length}</strong><small>{customs.length} extra columns kept as merge tags</small></div>
            <div className="dash-stat"><span>Unknown merge tags</span><strong>{unknownTags.length}</strong><small>{unknownTags.length ? 'Not found in this list' : 'Copy matches this list'}</small></div>
          </div>

          <div>
            <p className="label">Field titles</p>
            <ul className="mt-2 divide-y divide-border rounded-md border border-border">
              {shown.map((item) => {
                const sample = String(draft[0]?.[item.column] ?? '');
                return (
                  <li key={item.column} className="field-map-row">
                    <span className="mono text-sm">{'{'}{item.column}{'}'}</span>
                    <span className="field-map-arrow" aria-hidden>→</span>
                    <span className="text-sm font-semibold">{assignmentLabel(item)}</span>
                    <span className="truncate text-sm text-muted-foreground" title={sample}>{sample || 'empty'}</span>
                  </li>
                );
              })}
            </ul>
          </div>

          {unknownTags.length > 0 && (
            <div>
              <p className="label">Tags in your copy that this list does not have</p>
              <div className="flex flex-wrap gap-2">
                {unknownTags.map((tag) => <span key={tag} className="tag-chip text-warning">{'{'}{tag}{'}'}</span>)}
              </div>
            </div>
          )}

          <ScrollArea className="max-h-[22dvh] rounded-md border border-border">
            <table className="preview-table">
              <thead>
                <tr>
                  {shown.map((item) => (
                    <th key={item.column} scope="col">
                      <span className="block normal-case tracking-normal text-foreground">{assignmentLabel(item)}</span>
                      <span className="mt-0.5 block font-normal normal-case tracking-normal text-muted-foreground">{item.column}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {draft.slice(0, 8).map((row) => (
                  <tr key={row.row}>
                    {previewColumns.map((column) => {
                      const value = String(row[column] ?? '');
                      const empty = !value.trim();
                      const assignment = map.find((item) => item.column === column);
                      return (
                        <td key={column} className={empty ? 'is-empty' : ''} title={value}>
                          {assignment?.use === 'portrait' && !empty ? (
                            <span className="inline-flex items-center gap-2"><DurablePortrait src={value} className="h-6 w-6 rounded-full object-cover" size={24} /><span className="truncate">{value}</span></span>
                          ) : empty ? (
                            <span className="inline-flex items-center gap-1"><TriangleAlert size={14} aria-hidden /> empty</span>
                          ) : value}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
            <ScrollBar orientation="horizontal" />
          </ScrollArea>

          {mappedPreview && (
            <p className="rounded-md bg-surface-2 p-3 text-sm leading-relaxed">
              This row will read as <strong>{String(mappedPreview.first_name || mappedPreview.name || '—')}</strong>
              {mappedPreview.company ? <> at <strong>{String(mappedPreview.company)}</strong></> : null}
              {mappedPreview.email ? <> · {String(mappedPreview.email)}</> : null}
              {mappedPreview.role ? <> · {String(mappedPreview.role)}</> : null}.
            </p>
          )}

          <div>
            <p className="label">Insert a used field</p>
            <div className="flex flex-wrap gap-2">
              {['row', ...mappedColumns].map((column) => (
                <button type="button" key={column} className="tag-chip" onClick={() => onInsertTag(`{${column}}`)}>
                  {'{'}{column}{'}'}
                </button>
              ))}
            </div>
          </div>
          {portraitColumn && <p className="helper">Portraits come from <span className="mono text-foreground">{'{'}{portraitColumn}{'}'}</span>.</p>}
          <p className="helper">
            Studios: {studioSummary}. After save, {openStudio} opens. Generate writes file names and public links back onto this spreadsheet, saves them to Supabase, and puts them in the download CSV and ZIP.
          </p>
        </div>
      )}
      </div>

      <div className="mt-4 flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
        <div>
          {step !== 'source' && (
            <button type="button" className="btn btn-quiet" onClick={() => setStep('source')}>
              <ArrowLeft size={16} aria-hidden /> Back
            </button>
          )}
        </div>
        <div className="flex gap-2">
          <button type="button" className="btn btn-ghost" onClick={() => onOpenChange(false)}>Cancel</button>
          {step === 'source' && draft && (
            <button type="button" className="btn btn-primary" onClick={() => setStep('review')}>
              Next <ArrowRight size={16} aria-hidden />
            </button>
          )}
          {step === 'review' && (
            <button type="button" className="btn btn-primary" onClick={confirm}>
              <Check size={16} aria-hidden /> Save to {destinations.length === 1 ? studioModes.find((item) => item.id === destinations[0])?.label : `${destinations.length} studios`}
            </button>
          )}
        </div>
      </div>
    </div>
  );

  const heading = {
    title: 'Import prospect list',
    description: 'Pick the studio, drop a spreadsheet, and fields are matched for you. Generate then writes the created files back into that list.',
  };

  if (desktop) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="flex max-h-[90dvh] min-h-0 w-[min(880px,calc(100vw-48px))] max-w-none flex-col gap-6 overflow-hidden rounded-[12px] border-border bg-card p-6 shadow-[var(--shadow-overlay)] sm:max-w-none [&>button]:right-4 [&>button]:top-4 [&>button]:h-11 [&>button]:w-11 [&>button]:rounded-md [&>button]:opacity-100 [&>button>svg]:mx-auto [&>button>svg]:h-5 [&>button>svg]:w-5">
          <DialogHeader className="pr-12 text-left">
            <DialogTitle className="display text-2xl font-semibold">{heading.title}</DialogTitle>
            <DialogDescription className="text-sm">{heading.description}</DialogDescription>
          </DialogHeader>
          <Wrap>{body}</Wrap>
        </DialogContent>
      </Dialog>
    );
  }
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="sheet-inspector gap-0 border-border bg-card p-4 shadow-[var(--shadow-overlay)] [&>button]:right-3 [&>button]:top-3 [&>button]:h-11 [&>button]:w-11 [&>button]:rounded-md [&>button]:opacity-100 [&>button>svg]:mx-auto [&>button>svg]:h-5 [&>button>svg]:w-5">
        <SheetHeader className="pr-12 text-left">
          <SheetTitle className="display text-2xl font-semibold">{heading.title}</SheetTitle>
          <SheetDescription className="text-sm">{heading.description}</SheetDescription>
        </SheetHeader>
        <div className="mt-4 min-h-0 flex-1 overflow-y-auto pb-2"><Wrap>{body}</Wrap></div>
      </SheetContent>
    </Sheet>
  );
}

function Wrap({ children }: { children: ReactNode }) {
  return <div className="flex min-h-0 flex-1 flex-col overflow-hidden">{children}</div>;
}
