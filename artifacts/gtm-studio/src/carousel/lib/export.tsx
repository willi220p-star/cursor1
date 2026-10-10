import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { StaticDeck } from "@/carousel/components/static-slide";
import { fontsMap } from "@/carousel/lib/fonts-map";
import { getExportSize, getPageSize } from "@/carousel/lib/page-size";
import { FALLBACK_CONTACT, hasMergeTags, personaliseDocument, type CarouselDocument } from "@/carousel/lib/personalise";

/**
 * Export pipeline. Each slide is rendered read-only off screen at its 400px layout size and
 * rasterised straight to a 1080px-wide canvas (1080 × 1350 or 1080 × 1080), one canvas per page.
 * PDFs embed those canvases at true size as high-quality JPEG; slide images are PNG.
 * html-to-image and jsPDF load only when an export starts, so the editor chunk stays small.
 */

export const PDF_JPEG_QUALITY = 0.92;

type HtmlToImage = typeof import("html-to-image");

function nextFrame() {
  return new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
}

async function waitForImages(host: HTMLElement) {
  const images = Array.from(host.querySelectorAll("img"));
  await Promise.all(
    images.map(async (image) => {
      if (!image.complete) {
        await new Promise<void>((resolve) => {
          image.addEventListener("load", () => resolve(), { once: true });
          image.addEventListener("error", () => resolve(), { once: true });
        });
      }
      try {
        await image.decode();
      } catch {
        // A broken image renders as empty space; the rest of the slide still exports.
      }
    }),
  );
}

async function waitForFonts(document_: CarouselDocument, host: HTMLElement) {
  void host.offsetHeight;
  const fonts = typeof document !== "undefined" ? document.fonts : undefined;
  if (!fonts) return;
  const families = [document_.config.fonts.font1, document_.config.fonts.font2]
    .map((id) => fontsMap[id]?.name)
    .filter(Boolean) as string[];
  try {
    await Promise.all(families.flatMap((family) => ["400", "700", "900"].map((weight) => fonts.load(`${weight} 32px "${family}"`))));
    await fonts.ready;
  } catch {
    // Offline or blocked fonts fall back to the system stack.
  }
}

export type RenderSession = {
  render: (document: CarouselDocument) => Promise<HTMLCanvasElement[]>;
  close: () => void;
};

/** Mounts one hidden stage and reuses it for every deck rendered in a batch. */
export async function openRenderSession(): Promise<RenderSession> {
  const htmlToImage: HtmlToImage = await import("html-to-image");
  const host = document.createElement("div");
  host.setAttribute("aria-hidden", "true");
  host.dataset.carouselExportStage = "";
  host.style.cssText = "position:fixed;left:-20000px;top:0;pointer-events:none;z-index:-1;";
  document.body.appendChild(host);
  const root: Root = createRoot(host);
  let fontEmbedCSS: string | null = null;

  const render = async (deck: CarouselDocument) => {
    flushSync(() => root.render(<StaticDeck document={deck} />));
    await nextFrame();
    await waitForFonts(deck, host);
    await waitForImages(host);
    if (fontEmbedCSS === null) {
      try {
        fontEmbedCSS = await htmlToImage.getFontEmbedCSS(host);
      } catch {
        fontEmbedCSS = "";
      }
    }
    const layout = getPageSize(deck.config.format);
    const output = getExportSize(deck.config.format);
    const nodes = Array.from(host.querySelectorAll<HTMLElement>("[data-export-slide]"));
    const canvases: HTMLCanvasElement[] = [];
    for (const node of nodes) {
      const canvas = await htmlToImage.toCanvas(node, {
        width: layout.width,
        height: layout.height,
        canvasWidth: output.width,
        canvasHeight: output.height,
        pixelRatio: 1,
        backgroundColor: deck.config.theme.background,
        ...(fontEmbedCSS ? { fontEmbedCSS } : { skipFonts: true }),
      });
      canvases.push(canvas);
    }
    return canvases;
  };

  return {
    render,
    close: () => {
      root.unmount();
      host.remove();
    },
  };
}

/** The deck as it ships with no contact: tags fall back to their defaults, e.g. "{first_name|there}" reads "there". */
export function genericDocument(document: CarouselDocument) {
  return hasMergeTags(document) ? personaliseDocument(document, FALLBACK_CONTACT) : document;
}

export async function canvasesToPdf(canvases: HTMLCanvasElement[], format: CarouselDocument["config"]["format"]) {
  const { jsPDF } = await import("jspdf");
  const { width, height } = getExportSize(format);
  // Points, so the MediaBox is exactly 1080 × 1350 (or 1080 × 1080) and each image sits at 1:1.
  const pdf = new jsPDF({ unit: "pt", format: [width, height], orientation: "portrait", compress: true });
  canvases.forEach((canvas, index) => {
    if (index) pdf.addPage([width, height], "portrait");
    pdf.addImage(canvas.toDataURL("image/jpeg", PDF_JPEG_QUALITY), "JPEG", 0, 0, width, height, undefined, "NONE");
  });
  return pdf.output("blob");
}

export function canvasToPng(canvas: HTMLCanvasElement) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Could not encode the slide image."))), "image/png");
  });
}

export async function exportPdf(document: CarouselDocument) {
  const session = await openRenderSession();
  try {
    const canvases = await session.render(document);
    return await canvasesToPdf(canvases, document.config.format);
  } finally {
    session.close();
  }
}

export async function exportPngs(document: CarouselDocument) {
  const session = await openRenderSession();
  try {
    const canvases = await session.render(document);
    return await Promise.all(canvases.map((canvas) => canvasToPng(canvas)));
  } finally {
    session.close();
  }
}
