import { useEffect, useState } from "react";
import { Cloud, HardDrive, LayoutTemplate, Trash2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { relativeTime } from "@/studio/activity";
import { STARTER_DECKS } from "@/carousel/lib/starter-decks";
import type { SavedCarousel } from "@/carousel/lib/storage";
import { useStudio } from "@/carousel/lib/providers/studio-context";

export function CarouselLibraryDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const studio = useStudio();
  const [tab, setTab] = useState<"layouts" | "saved">("saved");
  const [saved, setSaved] = useState<SavedCarousel[] | null>(null);
  const [loadError, setLoadError] = useState("");
  const [busyId, setBusyId] = useState("");
  const { listSaved } = studio;

  useEffect(() => {
    if (!open) return;
    let live = true;
    setLoadError("");
    setSaved(null);
    listSaved()
      .then((items) => {
        if (!live) return;
        setSaved(items);
        if (!items.length) setTab("layouts");
      })
      .catch((reason: unknown) => {
        if (!live) return;
        setSaved([]);
        setLoadError(reason instanceof Error ? reason.message : "Could not load your saved carousels.");
      });
    return () => {
      live = false;
    };
  }, [open, listSaved]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] max-w-2xl overflow-y-auto border-border bg-card">
        <DialogHeader>
          <DialogTitle className="display text-2xl">Carousel library</DialogTitle>
          <DialogDescription>Open a saved carousel or start from a layout. Layouts keep your brand, theme and fonts.</DialogDescription>
        </DialogHeader>
        <div className="segmented self-start" role="tablist" aria-label="Library sections">
          <button type="button" role="tab" aria-selected={tab === "saved"} onClick={() => setTab("saved")}>
            Saved <span className="count">{saved ? saved.length : ""}</span>
          </button>
          <button type="button" role="tab" aria-selected={tab === "layouts"} onClick={() => setTab("layouts")}>
            Starter layouts <span className="count">{STARTER_DECKS.length}</span>
          </button>
        </div>

        {tab === "layouts" ? (
          <ul className="grid gap-3 sm:grid-cols-2" aria-label="Starter layouts">
            {STARTER_DECKS.map((deck) => (
              <li key={deck.id} className="panel flex flex-col gap-3 p-4">
                <div className="flex items-start gap-3">
                  <span className="item-mark" data-studio="carousel" aria-hidden>
                    <LayoutTemplate size={18} />
                  </span>
                  <span className="min-w-0">
                    <strong className="block text-[15px] font-semibold">{deck.name}</strong>
                    <small className="block text-sm text-muted-foreground">
                      {deck.description} {deck.slides().length} slides.
                    </small>
                  </span>
                </div>
                <button
                  type="button"
                  className="btn btn-quiet btn-sm self-start"
                  onClick={() => {
                    studio.startNew(deck);
                    onOpenChange(false);
                  }}
                >
                  Use this layout
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <div className="flex flex-col gap-3">
            {loadError ? (
              <p className="field-error" role="alert">
                Supabase list failed: {loadError}. Carousels saved on this device still show below.
              </p>
            ) : null}
            {saved === null ? (
              <p className="helper" aria-busy="true">Loading saved carousels…</p>
            ) : saved.length ? (
              <ul className="group-list" aria-label="Saved carousels">
                {saved.map((item) => (
                  <li
                    key={item.id}
                    className="group-row"
                    data-carousel-id={item.id}
                    onClick={() => {
                      void studio.openSaved(item);
                      onOpenChange(false);
                    }}
                  >
                    <span className="item-mark" data-studio="carousel" aria-hidden>
                      {item.cloud ? <Cloud size={18} /> : <HardDrive size={18} />}
                    </span>
                    <span className="item-text">
                      <strong title={item.title}>{item.title}</strong>
                      <small>
                        {item.cloud ? "In Supabase" : "On this device only"}
                        {item.id === studio.currentId ? ", open now" : ""}
                      </small>
                    </span>
                    <span className="item-when hidden sm:inline">{relativeTime(item.savedAt)}</span>
                    <span className="flex flex-none items-center gap-2" onClick={(event) => event.stopPropagation()}>
                      <button
                        type="button"
                        className="btn btn-quiet btn-sm"
                        onClick={() => {
                          void studio.openSaved(item);
                          onOpenChange(false);
                        }}
                      >
                        Open
                      </button>
                      <button
                        type="button"
                        className="btn btn-danger btn-icon"
                        aria-label={`Delete ${item.title}`}
                        disabled={busyId === item.id}
                        onClick={async () => {
                          if (!window.confirm(`Delete ${item.title}? This cannot be undone.`)) return;
                          setBusyId(item.id);
                          await studio.removeSaved(item);
                          setBusyId("");
                          setSaved((current) => current?.filter((entry) => entry.id !== item.id) ?? null);
                        }}
                      >
                        <Trash2 size={16} aria-hidden />
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="group-list empty-state p-6 text-center">
                <p className="font-semibold">No saved carousels yet</p>
                <p className="helper">Press Save in the toolbar. Signed in, each carousel is kept in your Supabase library.</p>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
