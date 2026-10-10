import { useRef, useState } from "react";
import { useFormContext } from "react-hook-form";
import { Download, FileJson, FileUp, FolderOpen, Images, MoreHorizontal, PenLine, RotateCcw, Save, SquarePlus } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Progress } from "@/components/ui/progress";
import type { DocumentFormReturn } from "@/carousel/lib/document-form-types";
import { PAGE_FORMATS, PageFormat } from "@/carousel/lib/page-size";
import { defaultValues } from "@/carousel/lib/default-document";
import { useStudio } from "@/carousel/lib/providers/studio-context";
import { CarouselLibraryDialog } from "@/carousel/components/carousel-library";

export function CarouselHeader() {
  const form: DocumentFormReturn = useFormContext();
  const studio = useStudio();
  const [libraryOpen, setLibraryOpen] = useState(false);
  const importInput = useRef<HTMLInputElement>(null);
  const format = form.watch("config.format") ?? "portrait";
  const busy = Boolean(studio.exporting);

  return (
    <div className="carousel-header flex flex-col gap-3">
      <header className="studio-toolbar">
        <div className="studio-title min-w-0">
          <p className="eyebrow">Carousel</p>
          <h1 className="flex items-center gap-2">
            <input className="campaign-title" aria-label="Carousel name" placeholder="Untitled carousel" {...form.register("filename")} />
            <PenLine size={16} className="flex-none text-muted-foreground" aria-hidden />
          </h1>
        </div>
        <div className="segmented studio-steps" role="group" aria-label="Page size">
          {PageFormat.options.map((option) => (
            <button
              type="button"
              key={option}
              aria-pressed={format === option}
              title={`Export at ${PAGE_FORMATS[option].detail}`}
              aria-label={`${PAGE_FORMATS[option].label}, ${PAGE_FORMATS[option].detail}`}
              onClick={() => form.setValue("config.format", option, { shouldDirty: true })}
            >
              {PAGE_FORMATS[option].label}
            </button>
          ))}
        </div>
        <div className="toolbar-actions flex flex-wrap items-center justify-end gap-2">
          <button type="button" className="btn btn-quiet" onClick={() => setLibraryOpen(true)}>
            <FolderOpen size={16} aria-hidden /> Library
          </button>
          <button
            type="button"
            className="btn btn-quiet"
            onClick={() => void studio.save()}
            data-loading={studio.saving || undefined}
            aria-busy={studio.saving || undefined}
          >
            <Save size={16} aria-hidden /> Save
          </button>
          <button
            type="button"
            className="btn btn-quiet"
            onClick={() => void studio.downloadImages()}
            disabled={busy}
            data-loading={studio.exporting === "images" || undefined}
            aria-busy={studio.exporting === "images" || undefined}
          >
            <Images size={16} aria-hidden /> Slide images
          </button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button type="button" className="btn btn-quiet btn-icon" aria-label="More carousel actions">
                <MoreHorizontal size={18} aria-hidden />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-56 border-border bg-popover">
              <DropdownMenuItem className="min-h-11" onSelect={() => studio.startNew()}>
                <SquarePlus aria-hidden /> Save as a new carousel
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem className="min-h-11" onSelect={() => studio.exportJson()}>
                <FileJson aria-hidden /> Export JSON
              </DropdownMenuItem>
              <DropdownMenuItem className="min-h-11" onSelect={() => importInput.current?.click()}>
                <FileUp aria-hidden /> Import JSON
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="min-h-11"
                onSelect={() => {
                  if (window.confirm("Reset slides, brand and theme to the defaults? Save first to keep this carousel.")) {
                    form.reset({ ...defaultValues, filename: "Untitled carousel" });
                  }
                }}
              >
                <RotateCcw aria-hidden /> Reset to defaults
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => void studio.downloadPdf()}
            disabled={busy}
            data-loading={studio.exporting === "pdf" || undefined}
            aria-busy={studio.exporting === "pdf" || undefined}
          >
            <Download size={16} aria-hidden /> Download PDF
          </button>
        </div>
      </header>
      {studio.progress && studio.exporting === "batch" ? (
        <div className="batch-progress" role="status" aria-live="polite">
          <strong>{studio.progress.label}</strong>
          <Progress
            value={Math.round((studio.progress.done / Math.max(1, studio.progress.total)) * 100)}
            aria-label="Export progress"
            className="h-2 flex-1 bg-fill [&>div]:bg-studio"
          />
          <button type="button" className="btn btn-quiet btn-sm" onClick={studio.cancelExport}>
            Stop
          </button>
        </div>
      ) : null}
      <input
        ref={importInput}
        type="file"
        accept="application/json,.json"
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={async (event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) studio.loadEnvelopeText(await file.text());
        }}
      />
      <CarouselLibraryDialog open={libraryOpen} onOpenChange={setLibraryOpen} />
    </div>
  );
}
