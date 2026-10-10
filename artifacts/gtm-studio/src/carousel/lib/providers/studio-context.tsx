import React, { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useFormContext } from "react-hook-form";
import { useSearch } from "wouter";
import { toast } from "sonner";
import { saveAs } from "file-saver";
import type { DocumentFormReturn } from "@/carousel/lib/document-form-types";
import { usePagerContext } from "@/carousel/lib/providers/pager-context";
import { useSelectionContext } from "@/carousel/lib/providers/selection-context";
import {
  carouselFilename,
  carouselIdFromPath,
  carouselStoragePath,
  cleanCarouselTitle,
  listLocalCarousels,
  loadLocalCarousel,
  mergeCarouselLists,
  newCarouselId,
  parseCarousel,
  readCurrentCarouselId,
  removeLocalCarousel,
  saveLocalCarousel,
  serializeCarousel,
  writeCurrentCarouselId,
  type SavedCarousel,
} from "@/carousel/lib/storage";
import {
  capRows,
  documentMissingTags,
  personaliseDocument,
  personalisedFilenames,
  slideImageFilenames,
  DEFAULT_FILENAME_PATTERN,
  type CarouselDocument,
} from "@/carousel/lib/personalise";
import type { StarterDeck } from "@/carousel/lib/starter-decks";
import type { Contact } from "@/studio/types";
import { listCarouselFiles, loadCarouselFile, removeStoredFile, saveCarouselFile, supabaseConfigured } from "@/studio/cloud";

export type ExportJob = "pdf" | "images" | "batch";

type Progress = { done: number; total: number; label: string };

type PersonaliseState = {
  contacts: Contact[];
  source: string;
  dropped: number;
  selectedRow: number | null;
  pattern: string;
};

interface StudioContextValue {
  userId?: string;
  currentId: string;
  saving: boolean;
  exporting: ExportJob | null;
  progress: Progress | null;
  save: () => Promise<void>;
  listSaved: () => Promise<SavedCarousel[]>;
  openSaved: (item: SavedCarousel) => Promise<void>;
  removeSaved: (item: SavedCarousel) => Promise<void>;
  startNew: (deck?: StarterDeck) => void;
  loadEnvelopeText: (text: string) => void;
  exportJson: () => void;
  downloadPdf: (contact?: Contact) => Promise<void>;
  downloadImages: (contact?: Contact) => Promise<void>;
  downloadPersonalisedZip: () => Promise<void>;
  cancelExport: () => void;
  personalise: PersonaliseState;
  setContacts: (contacts: Contact[], source: string) => { dropped: number };
  clearContacts: () => void;
  setSelectedRow: (row: number | null) => void;
  setPattern: (pattern: string) => void;
  selectedContact: Contact | null;
}

const StudioContext = React.createContext<StudioContextValue | undefined>(undefined);

function errorText(reason: unknown, fallback: string) {
  if (reason instanceof Error && reason.message) return reason.message;
  if (reason && typeof reason === "object" && "message" in reason && typeof reason.message === "string") return reason.message;
  return fallback;
}

export function StudioProvider({ userId, children }: { userId?: string; children: React.ReactNode }) {
  const form: DocumentFormReturn = useFormContext();
  const { setCurrentPage } = usePagerContext();
  const { setCurrentSelection } = useSelectionContext();
  const search = useSearch();
  const [currentId, setCurrentIdState] = useState(() => readCurrentCarouselId() || newCarouselId());
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState<ExportJob | null>(null);
  const [progress, setProgress] = useState<Progress | null>(null);
  const cancelled = useRef(false);
  const [personalise, setPersonalise] = useState<PersonaliseState>({
    contacts: [],
    source: "",
    dropped: 0,
    selectedRow: null,
    pattern: DEFAULT_FILENAME_PATTERN,
  });

  const setCurrentId = useCallback((id: string) => {
    setCurrentIdState(id);
    writeCurrentCarouselId(id);
  }, []);

  const applyDocument = useCallback(
    (document: CarouselDocument, id: string) => {
      setCurrentSelection("", null);
      form.reset(document);
      setCurrentPage(0);
      setCurrentId(id);
    },
    [form, setCurrentPage, setCurrentSelection, setCurrentId],
  );

  const save = useCallback(async () => {
    if (saving) return;
    setSaving(true);
    try {
      const document = form.getValues();
      const title = cleanCarouselTitle(document.filename);
      const savedAt = new Date().toISOString();
      const body = serializeCarousel(document, { id: currentId, title, savedAt });
      const envelope = parseCarousel(body);
      const keptLocally = saveLocalCarousel(envelope, userId);
      writeCurrentCarouselId(currentId);
      if (supabaseConfigured && userId) {
        try {
          await saveCarouselFile(body, { id: currentId, title, savedAt, filename: carouselFilename(title), storagePath: carouselStoragePath(userId, currentId) }, userId);
          toast.success(`${title} saved`, { description: "Saved to your library in Supabase." });
        } catch (reason) {
          toast.error("Saved on this device only", { description: errorText(reason, "Supabase did not accept the file. Try Save again.") });
        }
      } else if (keptLocally) {
        toast.success(`${title} saved on this device`, { description: "Sign in to keep carousels in your Supabase library." });
      } else {
        toast.error("Could not save", { description: "This browser's storage is full or blocked. Use More, then Export JSON, to keep a copy." });
      }
    } finally {
      setSaving(false);
    }
  }, [saving, form, currentId, userId]);

  const listSaved = useCallback(async () => {
    const local = listLocalCarousels(userId);
    if (!supabaseConfigured || !userId) return local;
    const cloud = (await listCarouselFiles(userId)).map((row) => ({ ...row, cloud: true }));
    return mergeCarouselLists(cloud, local);
  }, [userId]);

  const openSaved = useCallback(
    async (item: SavedCarousel) => {
      try {
        const envelope = item.cloud
          ? parseCarousel(await loadCarouselFile(item.storagePath, userId), { id: item.id, title: item.title })
          : loadLocalCarousel(item.id, userId);
        if (!envelope) throw new Error("That carousel is no longer on this device.");
        applyDocument({ ...envelope.document, filename: envelope.title }, envelope.id);
        toast.success(`Opened ${envelope.title}`);
      } catch (reason) {
        toast.error("Could not open that carousel", { description: errorText(reason, "Try again in a moment.") });
      }
    },
    [applyDocument, userId],
  );

  const removeSaved = useCallback(
    async (item: SavedCarousel) => {
      removeLocalCarousel(item.id, userId);
      if (item.cloud && item.storagePath) {
        const { syncError } = await removeStoredFile({ storagePath: item.storagePath }, userId);
        if (syncError) {
          toast.error(`Could not delete ${item.title}`, { description: syncError });
          return;
        }
      }
      if (item.id === currentId) setCurrentId(newCarouselId());
      toast.success(`${item.title} deleted`);
    },
    [userId, currentId, setCurrentId],
  );

  const startNew = useCallback(
    (deck?: StarterDeck) => {
      const current = form.getValues();
      applyDocument(
        { ...current, slides: deck ? deck.slides() : current.slides, filename: deck ? deck.name : "Untitled carousel" },
        newCarouselId(),
      );
      if (deck) toast.success(`${deck.name} loaded`, { description: "Your brand, theme and fonts are kept. Save to add it to your library." });
    },
    [applyDocument, form],
  );

  const loadEnvelopeText = useCallback(
    (text: string) => {
      try {
        const envelope = parseCarousel(text);
        applyDocument({ ...envelope.document, filename: envelope.title }, newCarouselId());
        toast.success(`Imported ${envelope.title}`);
      } catch (reason) {
        toast.error("Could not import that file", { description: errorText(reason, "Choose a carousel JSON file.") });
      }
    },
    [applyDocument],
  );

  const exportJson = useCallback(() => {
    const document = form.getValues();
    const title = cleanCarouselTitle(document.filename);
    const body = serializeCarousel(document, { id: currentId, title });
    saveAs(new Blob([body], { type: "application/json" }), carouselFilename(title));
  }, [form, currentId]);

  // Opening /carousel?open=<storage path> (from the Desk library) loads that saved deck once.
  const openedFromLink = useRef("");
  useEffect(() => {
    const path = new URLSearchParams(search).get("open");
    if (!path || openedFromLink.current === path || !userId) return;
    openedFromLink.current = path;
    void openSaved({ id: carouselIdFromPath(path) || newCarouselId(), title: "Carousel", savedAt: "", storagePath: path, cloud: true });
  }, [search, userId, openSaved]);

  const runExport = useCallback(
    async (job: ExportJob, work: () => Promise<void>) => {
      if (exporting) return;
      cancelled.current = false;
      setExporting(job);
      try {
        await work();
      } catch (reason) {
        toast.error("Export failed", { description: errorText(reason, "Try again, or remove any image that will not load.") });
      } finally {
        setExporting(null);
        setProgress(null);
      }
    },
    [exporting],
  );

  const selectedContact = useMemo(
    () => personalise.contacts.find((contact) => contact.row === personalise.selectedRow) ?? null,
    [personalise.contacts, personalise.selectedRow],
  );

  const downloadPdf = useCallback(
    (contact?: Contact) =>
      runExport("pdf", async () => {
        const { exportPdf, genericDocument } = await import("@/carousel/lib/export");
        const document = form.getValues();
        const deck = contact ? personaliseDocument(document, contact) : genericDocument(document);
        setProgress({ done: 0, total: 1, label: "Rendering slides" });
        const blob = await exportPdf(deck);
        const name = contact ? personalisedFilenames([contact], personalise.pattern)[0] : `${cleanCarouselTitle(document.filename).replace(/[^\w.-]+/g, "-")}.pdf`;
        saveAs(blob, name);
        toast.success("PDF downloaded", { description: `${deck.slides.length} pages at ${deck.config.format === "square" ? "1080 × 1080" : "1080 × 1350"}.` });
      }),
    [runExport, form, personalise.pattern],
  );

  const downloadImages = useCallback(
    (contact?: Contact) =>
      runExport("images", async () => {
        const [{ exportPngs, genericDocument }, { default: JSZip }] = await Promise.all([import("@/carousel/lib/export"), import("jszip")]);
        const document = form.getValues();
        const deck = contact ? personaliseDocument(document, contact) : genericDocument(document);
        setProgress({ done: 0, total: 1, label: "Rendering slides" });
        const blobs = await exportPngs(deck);
        const zip = new JSZip();
        const names = slideImageFilenames(document.filename, blobs.length);
        blobs.forEach((blob, index) => zip.file(names[index], blob));
        const stem = cleanCarouselTitle(document.filename).replace(/[^\w.-]+/g, "-");
        saveAs(await zip.generateAsync({ type: "blob" }), `${stem}-slides.zip`);
        toast.success(`${blobs.length} slide images downloaded`, { description: contact ? "Personalised for the previewed contact." : "One PNG per slide in a ZIP." });
      }),
    [runExport, form],
  );

  const downloadPersonalisedZip = useCallback(
    () =>
      runExport("batch", async () => {
        const contacts = personalise.contacts;
        if (!contacts.length) throw new Error("Import a contact list first.");
        const [{ openRenderSession, canvasesToPdf }, { default: JSZip }] = await Promise.all([import("@/carousel/lib/export"), import("jszip")]);
        const document = form.getValues();
        const names = personalisedFilenames(contacts, personalise.pattern);
        const zip = new JSZip();
        const manifest: Array<{ row: number; filename: string; missing_tags: string }> = [];
        const session = await openRenderSession();
        try {
          for (let index = 0; index < contacts.length; index++) {
            if (cancelled.current) break;
            const contact = contacts[index];
            setProgress({ done: index, total: contacts.length, label: `Making ${index + 1} of ${contacts.length}` });
            const canvases = await session.render(personaliseDocument(document, contact));
            zip.file(names[index], await canvasesToPdf(canvases, document.config.format), { compression: "STORE" });
            manifest.push({ row: contact.row, filename: names[index], missing_tags: documentMissingTags(document, contact).join(" ") });
          }
        } finally {
          session.close();
        }
        if (!manifest.length) return;
        const header = "row,filename,missing_tags";
        const quote = (value: string | number) => `"${String(value).replace(/"/g, '""')}"`;
        zip.file("manifest.csv", [header, ...manifest.map((item) => [item.row, item.filename, item.missing_tags].map(quote).join(","))].join("\n"));
        setProgress({ done: manifest.length, total: contacts.length, label: "Packing the ZIP" });
        const stem = cleanCarouselTitle(document.filename).replace(/[^\w.-]+/g, "-");
        saveAs(await zip.generateAsync({ type: "blob" }), `${stem}-personalised.zip`);
        const stopped = manifest.length < contacts.length;
        toast.success(`${manifest.length} personalised PDFs downloaded`, {
          description: stopped ? `Stopped early. ${contacts.length - manifest.length} contacts were skipped.` : "manifest.csv lists each file and any missing tags.",
        });
      }),
    [runExport, form, personalise.contacts, personalise.pattern],
  );

  const setContacts = useCallback((contacts: Contact[], source: string) => {
    const { rows, dropped } = capRows(contacts);
    setPersonalise((current) => ({ ...current, contacts: rows, source, dropped, selectedRow: rows[0]?.row ?? null }));
    return { dropped };
  }, []);

  const value: StudioContextValue = {
    userId,
    currentId,
    saving,
    exporting,
    progress,
    save,
    listSaved,
    openSaved,
    removeSaved,
    startNew,
    loadEnvelopeText,
    exportJson,
    downloadPdf,
    downloadImages,
    downloadPersonalisedZip,
    cancelExport: () => {
      cancelled.current = true;
    },
    personalise,
    setContacts,
    clearContacts: () => setPersonalise((current) => ({ ...current, contacts: [], source: "", dropped: 0, selectedRow: null })),
    setSelectedRow: (row) => setPersonalise((current) => ({ ...current, selectedRow: row })),
    setPattern: (pattern) => setPersonalise((current) => ({ ...current, pattern })),
    selectedContact,
  };

  return <StudioContext.Provider value={value}>{children}</StudioContext.Provider>;
}

export function useStudio() {
  const context = useContext(StudioContext);
  if (!context) throw new Error("useStudio must be used within a StudioProvider");
  return context;
}
