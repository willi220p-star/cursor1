import * as z from "zod";

/** Editor pages are laid out 400px wide; exports scale them up to LinkedIn's 1080px. */
export const PageFormat = z.enum(["portrait", "square"]);
export type PageFormat = z.infer<typeof PageFormat>;

export const SIZE = {
  width: 400,
  height: 500,
};

export const EXPORT_WIDTH = 1080;

export const PAGE_FORMATS: Record<PageFormat, { label: string; detail: string; size: { width: number; height: number } }> = {
  portrait: { label: "4:5", detail: "1080 × 1350", size: { width: 400, height: 500 } },
  square: { label: "1:1", detail: "1080 × 1080", size: { width: 400, height: 400 } },
};

export function getPageSize(format: PageFormat | undefined) {
  return PAGE_FORMATS[format ?? "portrait"]?.size ?? SIZE;
}

/** Pixel size of an exported page: 1080 × 1350 for portrait, 1080 × 1080 for square. */
export function getExportSize(format: PageFormat | undefined) {
  const size = getPageSize(format);
  const scale = EXPORT_WIDTH / size.width;
  return { width: EXPORT_WIDTH, height: Math.round(size.height * scale), scale };
}
