import { useMemo, useState, type ChangeEvent } from "react";
import { useFormContext } from "react-hook-form";
import { CircleAlert, Download, FileArchive, FileSpreadsheet, Images, TriangleAlert, X } from "lucide-react";
import { importProspectFile, contactColumns } from "@/studio/importers";
import type { DocumentFormReturn } from "@/carousel/lib/document-form-types";
import {
  MAX_PERSONALISED_ROWS,
  contactLabel,
  documentMissingTags,
  hasMergeTags,
  personaliseDocument,
  personalisedFilenames,
  rowWarnings,
} from "@/carousel/lib/personalise";
import { getPageSize } from "@/carousel/lib/page-size";
import { useStudio } from "@/carousel/lib/providers/studio-context";
import { StaticSlide } from "@/carousel/components/static-slide";

const PREVIEW_WIDTH = 132;

export function PersonalisePanel() {
  const form: DocumentFormReturn = useFormContext();
  const studio = useStudio();
  const { personalise, selectedContact } = studio;
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const document = form.watch();

  const warnings = useMemo(() => rowWarnings(document, personalise.contacts), [document, personalise.contacts]);
  const selectedMissing = useMemo(() => (selectedContact ? documentMissingTags(document, selectedContact) : []), [document, selectedContact]);
  const preview = useMemo(() => (selectedContact ? personaliseDocument(document, selectedContact) : null), [document, selectedContact]);
  const columns = useMemo(() => contactColumns(personalise.contacts), [personalise.contacts]);
  const tagged = hasMergeTags(document);
  const size = getPageSize(document.config.format);
  const scale = PREVIEW_WIDTH / size.width;
  const exampleName = selectedContact ? personalisedFilenames([selectedContact], personalise.pattern)[0] : "";

  const onFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setError("");
    setBusy(true);
    try {
      const imported = await importProspectFile(file);
      studio.setContacts(imported.rows, file.name);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not read that file.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-4" data-carousel-personalise>
      <p className="helper">
        Write merge tags in any slide, like <code className="mono text-[13px]">{"{first_name|there}"}</code> or{" "}
        <code className="mono text-[13px]">{"{company|your team}"}</code>. The text after <code className="mono">|</code> is used when a cell is blank.
      </p>
      {!tagged ? (
        <p className="helper flex gap-2 rounded-[12px] bg-[var(--fill)] p-3">
          <CircleAlert size={16} className="mt-0.5 flex-none" aria-hidden />
          This carousel has no merge tags yet, so every contact gets the same slides.
        </p>
      ) : null}

      {personalise.contacts.length ? (
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <FileSpreadsheet size={16} className="flex-none text-muted-foreground" aria-hidden />
            <span className="min-w-0 flex-1 truncate text-sm font-semibold" title={personalise.source}>
              {personalise.source}
            </span>
            <span className="text-sm text-muted-foreground tabular">{personalise.contacts.length} rows</span>
            <button type="button" className="btn btn-ghost btn-icon" aria-label="Remove contact list" onClick={studio.clearContacts}>
              <X size={16} aria-hidden />
            </button>
          </div>
          {personalise.dropped ? (
            <p className="field-error" role="status">
              <TriangleAlert size={16} aria-hidden />
              Only the first {MAX_PERSONALISED_ROWS} rows are used. {personalise.dropped} more were left out; split the list to make the rest.
            </p>
          ) : null}
          {columns.length ? (
            <p className="helper">
              Tags you can use:{" "}
              {columns.slice(0, 12).map((column) => (
                <code key={column} className="mono mr-1 text-[13px]">{`{${column}}`}</code>
              ))}
            </p>
          ) : null}

          <label className="label-meta mb-0" htmlFor="carousel-preview-row">
            Preview for
          </label>
          <select
            id="carousel-preview-row"
            className="field"
            value={personalise.selectedRow ?? ""}
            onChange={(event) => studio.setSelectedRow(Number(event.target.value))}
          >
            {personalise.contacts.map((contact) => (
              <option key={contact.row} value={contact.row}>
                {contactLabel(contact)}
              </option>
            ))}
          </select>

          {selectedMissing.length ? (
            <p className="field-error" role="status">
              <TriangleAlert size={16} aria-hidden />
              Missing for this row: {selectedMissing.map((tag) => `{${tag}}`).join(", ")}. Add a fallback like {"{company|your team}"} or fill the cell.
            </p>
          ) : null}

          {preview ? (
            <div className="scrollbar-thin -mx-1 flex gap-2 overflow-x-auto px-1 pb-2" aria-label={`Preview for ${contactLabel(selectedContact!)}`}>
              {preview.slides.map((slide, index) => (
                <div
                  key={index}
                  className="flex-none overflow-hidden rounded-[8px] border border-border"
                  style={{ width: size.width * scale, height: size.height * scale }}
                >
                  <div style={{ transform: `scale(${scale})`, transformOrigin: "top left" }}>
                    <StaticSlide config={preview.config} slide={slide} index={index} />
                  </div>
                </div>
              ))}
            </div>
          ) : null}

          {warnings.length ? (
            <details className="rounded-[12px] border border-border p-3">
              <summary className="cursor-pointer text-sm font-semibold text-[var(--warning)]">
                {warnings.length} of {personalise.contacts.length} rows have missing tags
              </summary>
              <ul className="mt-2 flex max-h-40 flex-col gap-1 overflow-y-auto text-sm">
                {warnings.slice(0, 50).map((warning) => (
                  <li key={warning.row}>
                    <button type="button" className="text-left underline-offset-2 hover:underline" onClick={() => studio.setSelectedRow(warning.row)}>
                      Row {warning.row}, {warning.label}: {warning.tags.map((tag) => `{${tag}}`).join(", ")}
                    </button>
                  </li>
                ))}
              </ul>
            </details>
          ) : null}

          <div>
            <label className="label-meta" htmlFor="carousel-file-pattern">
              File name
            </label>
            <input
              id="carousel-file-pattern"
              className="field"
              value={personalise.pattern}
              onChange={(event) => studio.setPattern(event.target.value)}
              spellCheck={false}
            />
            {exampleName ? <p className="helper mt-1 truncate">For this row: {exampleName}</p> : null}
          </div>

          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              className="btn btn-quiet"
              disabled={!selectedContact || Boolean(studio.exporting)}
              data-loading={studio.exporting === "pdf" || undefined}
              onClick={() => selectedContact && void studio.downloadPdf(selectedContact)}
            >
              <Download size={16} aria-hidden /> This PDF
            </button>
            <button
              type="button"
              className="btn btn-quiet"
              disabled={!selectedContact || Boolean(studio.exporting)}
              data-loading={studio.exporting === "images" || undefined}
              onClick={() => selectedContact && void studio.downloadImages(selectedContact)}
            >
              <Images size={16} aria-hidden /> Its images
            </button>
            <button
              type="button"
              className="btn btn-primary col-span-2"
              disabled={Boolean(studio.exporting)}
              onClick={() => void studio.downloadPersonalisedZip()}
            >
              <FileArchive size={16} aria-hidden /> ZIP of {personalise.contacts.length} PDFs
            </button>
          </div>
          {studio.exporting === "batch" && studio.progress ? (
            <p className="helper" role="status" aria-live="polite">
              {studio.progress.label}.{" "}
              <button type="button" className="underline" onClick={studio.cancelExport}>
                Stop and keep finished
              </button>
            </p>
          ) : null}
        </div>
      ) : (
        <label className="flex cursor-pointer flex-col items-center gap-2 rounded-[16px] border border-dashed border-[var(--input)] bg-[var(--fill)] p-6 text-center">
          <FileSpreadsheet size={22} className="text-muted-foreground" aria-hidden />
          <span className="text-sm font-semibold">{busy ? "Reading list…" : "Import a contact list"}</span>
          <span className="helper">CSV or XLSX with a header row. Up to {MAX_PERSONALISED_ROWS} rows; one PDF per contact.</span>
          <input type="file" accept=".csv,.xlsx,.xls,.ods,.tsv,text/csv" className="sr-only" onChange={onFile} disabled={busy} />
        </label>
      )}
      {error ? (
        <p className="field-error" role="alert">
          <CircleAlert size={16} aria-hidden />
          {error}
        </p>
      ) : null}
    </div>
  );
}
