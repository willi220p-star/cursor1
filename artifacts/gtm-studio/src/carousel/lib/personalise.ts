import type * as z from "zod";
import type { DocumentSchema } from "@/carousel/lib/validation/document-schema";
import { missingTags, renderMerge, safeFilename } from "@/studio/merge";
import type { Contact } from "@/studio/types";

export type CarouselDocument = z.infer<typeof DocumentSchema>;

/** Personalised exports stop here so a browser tab never renders thousands of PDFs. */
export const MAX_PERSONALISED_ROWS = 200;

export const DEFAULT_FILENAME_PATTERN = "{first_name|prospect}-{company|carousel}";

/** A contact with no columns: tags fall back to their `|default`, e.g. `{first_name|there}` reads "there". */
export const FALLBACK_CONTACT: Contact = { row: 0 };

const TEXT_TYPES = new Set(["Title", "Subtitle", "Description"]);

/** Every piece of text a reader sees: slide copy plus the brand name and handle in the footer. */
export function documentText(document: CarouselDocument): string[] {
  const texts: string[] = [];
  for (const slide of document.slides) {
    for (const element of slide.elements) {
      if (TEXT_TYPES.has(element.type) && "text" in element && element.text) texts.push(element.text);
    }
  }
  if (document.config.brand.name) texts.push(document.config.brand.name);
  if (document.config.brand.handle) texts.push(document.config.brand.handle);
  return texts;
}

export function hasMergeTags(document: CarouselDocument) {
  return documentText(document).some((text) => /\{[^{}]+\}/.test(text));
}

/** A copy of the deck with every merge tag filled for this contact. The original is untouched. */
export function personaliseDocument(document: CarouselDocument, contact: Contact): CarouselDocument {
  const merge = (text: string) => renderMerge(text, contact);
  return {
    ...document,
    config: {
      ...document.config,
      brand: {
        ...document.config.brand,
        name: merge(document.config.brand.name),
        handle: merge(document.config.brand.handle),
      },
    },
    slides: document.slides.map((slide) => ({
      ...slide,
      elements: slide.elements.map((element) =>
        TEXT_TYPES.has(element.type) && "text" in element ? { ...element, text: merge(element.text) } : element,
      ),
    })),
  };
}

/** Tags that would read wrong for this contact: unknown columns or blank cells without a fallback. */
export function documentMissingTags(document: CarouselDocument, contact: Contact) {
  return [...new Set(documentText(document).flatMap((text) => missingTags(text, contact)))];
}

export type RowWarning = { row: number; label: string; tags: string[] };

export function rowWarnings(document: CarouselDocument, contacts: Contact[]): RowWarning[] {
  return contacts
    .map((contact) => ({ row: contact.row, label: contactLabel(contact), tags: documentMissingTags(document, contact) }))
    .filter((warning) => warning.tags.length > 0);
}

export function contactLabel(contact: Contact) {
  const name = String(contact.first_name || contact.name || contact.full_name || contact.email || "").trim();
  const company = String(contact.company || contact.company_name || "").trim();
  if (name && company) return `${name}, ${company}`;
  return name || company || `Row ${contact.row}`;
}

/** Keeps the first rows up to the cap and says how many were left out. */
export function capRows(contacts: Contact[], limit = MAX_PERSONALISED_ROWS) {
  return { rows: contacts.slice(0, limit), dropped: Math.max(0, contacts.length - limit) };
}

/** One PDF name per contact, made unique so no file in the ZIP overwrites another. */
export function personalisedFilenames(contacts: Contact[], pattern: string, extension = "pdf") {
  const used = new Map<string, number>();
  return contacts.map((contact) => {
    const name = safeFilename(pattern || DEFAULT_FILENAME_PATTERN, contact, extension);
    const count = used.get(name) ?? 0;
    used.set(name, count + 1);
    if (!count) return name;
    const stem = name.slice(0, -(extension.length + 1));
    return `${stem}-${count + 1}.${extension}`;
  });
}

export function slideImageFilenames(base: string, count: number) {
  const stem = base.replace(/\.[a-z0-9]+$/i, "").replace(/[^\w.-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "") || "carousel";
  const width = String(count).length < 2 ? 2 : String(count).length;
  return Array.from({ length: count }, (_, index) => `${stem}-${String(index + 1).padStart(width, "0")}.png`);
}
