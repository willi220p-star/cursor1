/// <reference lib="webworker" />
import { publicAssetUrl } from '@/lib/public-url';
import { drawCaptionLayer } from './caption-draw';
import { canvasCaptionMeasure, captionFont } from './caption-fit';
import { renderMerge } from './merge';
import type { Contact, StudioConfig } from './types';
import { canvasSizes, coverCropRect } from './types';

type RenderMessage = { id: string; config: StudioConfig; contact: Contact };

const sizes = canvasSizes;

/** The page loads the caption face from Google Fonts; a worker has its own font set, so load the same files here. */
const CAPTION_FONT_CSS = 'https://fonts.googleapis.com/css2?family=Anton&display=swap';
let captionFontReady: Promise<void> | null = null;

function loadCaptionFont() {
  captionFontReady ??= (async () => {
    try {
      const css = await (await fetch(CAPTION_FONT_CSS)).text();
      for (const block of css.match(/@font-face\s*{[^}]*}/g) ?? []) {
        const src = /src:\s*([^;]+);/.exec(block)?.[1];
        if (!src) continue;
        const range = /unicode-range:\s*([^;]+);/.exec(block)?.[1];
        self.fonts.add(new FontFace('Anton', src, range ? { unicodeRange: range } : {}));
      }
      await self.fonts.load(captionFont(40), 'Hg');
    } catch {
      // Offline: captions fall back to Impact or the system sans.
    }
  })();
  return captionFontReady;
}

function wrap(context: OffscreenCanvasRenderingContext2D, text: string, width: number) {
  const lines: string[] = [];
  for (const paragraph of text.split('\n')) {
    const words = paragraph.split(/\s+/);
    let line = '';
    for (const word of words) {
      const next = line ? `${line} ${word}` : word;
      if (line && context.measureText(next).width > width) {
        lines.push(line);
        line = word;
      } else line = next;
    }
    lines.push(line);
  }
  return lines;
}

async function imageBitmap(source?: string) {
  const url = publicAssetUrl(source);
  if (!url) return null;
  try {
    return await createImageBitmap(await (await fetch(url)).blob());
  } catch {
    return null;
  }
}

function cover(context: OffscreenCanvasRenderingContext2D, image: ImageBitmap, x: number, y: number, width: number, height: number, crop?: { zoom: number; x: number; y: number }) {
  const { sx, sy, sw, sh } = coverCropRect(image.width, image.height, width, height, crop ?? { zoom: 1, x: 0.5, y: 0.5 });
  context.drawImage(image, sx, sy, sw, sh, x, y, width, height);
}

function paper(context: OffscreenCanvasRenderingContext2D, config: StudioConfig, width: number, height: number) {
  const colors: Record<string, string> = {
    'Cream card': '#f5eddc',
    'Kraft paper': '#c9a879',
    'White marker card': '#fffefa',
    'Ruled notebook': '#f7f4ea',
    'Yellow post-it': '#ffe47a',
  };
  context.fillStyle = colors[config.template] ?? config.paperColor;
  context.fillRect(0, 0, width, height);
  if (config.template.includes('Lined') || config.template.includes('Ruled')) {
    context.strokeStyle = 'rgba(73,120,170,.22)';
    context.lineWidth = 2;
    for (let y = 90; y < height; y += 52) {
      context.beginPath(); context.moveTo(0, y); context.lineTo(width, y); context.stroke();
    }
  }
  if (config.template === 'Kraft paper') {
    context.fillStyle = 'rgba(70,42,20,.04)';
    for (let i = 0; i < 80; i++) context.fillRect((i * 97) % width, (i * 53) % height, 18, 2);
  }
}

async function render(config: StudioConfig, contact: Contact) {
  const { width, height } = sizes[config.channel] ?? sizes.LinkedIn;
  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Offscreen canvas is unavailable.');

  if (config.customFontDataUrl) {
    try {
      const face = new FontFace(config.fontFamily, await (await fetch(config.customFontDataUrl)).arrayBuffer());
      await face.load();
      self.fonts.add(face);
    } catch {
      // The renderer falls back to cursive when a browser cannot load a worker font.
    }
  }

  if (config.mode === 'handwritten') {
    paper(context, config, width, height);
    const background = await imageBitmap(config.customImage);
    if (background) { cover(context, background, 0, 0, width, height, config.imageCrop); background.close(); }
    context.fillStyle = config.inkColor;
    context.font = `${config.fontSize}px "${config.fontFamily}", cursive`;
    context.textBaseline = 'top';
    const copy = renderMerge(config.copy, contact, { hookColumn: config.hookColumn });
    const copyLines = wrap(context, copy, width * .76);
    copyLines.forEach((line, index) => {
      const jitter = ((contact.row + index * 7) % 5) - 2;
      context.fillText(line, width * config.noteX + jitter, height * config.noteY + index * config.fontSize * config.lineSpacing);
    });
    let cursorY = height * config.noteY + copyLines.length * config.fontSize * config.lineSpacing + config.fontSize * 0.4;
    if (config.signature) {
      context.font = `${Math.max(34, config.fontSize * 1.2)}px "${config.fontFamily}", cursive`;
      context.fillText(renderMerge(config.signature, contact), width * .64, cursorY);
      cursorY += Math.max(34, config.fontSize * 1.2) * 1.35;
    }
    const signature = await imageBitmap(config.signatureImage);
    if (signature) {
      context.drawImage(signature, width * .62, cursorY - (config.signature ? Math.max(34, config.fontSize * 1.2) : 0), width * .22, height * .18);
      signature.close();
    }
    if (config.postscript) {
      context.font = `${config.fontSize}px "${config.fontFamily}", cursive`;
      wrap(context, renderMerge(config.postscript, contact), width * .76).forEach((line, index) => {
        const jitter = ((contact.row + index * 11) % 5) - 2;
        context.fillText(line, width * config.noteX + jitter, cursorY + index * config.fontSize * config.lineSpacing);
      });
    }
  } else {
    const palettes: Record<string, [string, string]> = {
      'Bold contrast': ['#f2aa21', '#6e2d91'],
      'Before / after': ['#243b55', '#141e30'],
      'Decision tension': ['#ef473a', '#cb2d3e'],
      Escalation: ['#ff512f', '#dd2476'],
      'Status quo pain': ['#263238', '#607d8b'],
      'Debate card': ['#ee4c2d', '#3d5afe'],
      'Fade statement': ['#fc4a1a', '#f7b733'],
      'Slide reveal': ['#1d2671', '#c33764'],
      'Two-state flip': ['#11998e', '#38ef7d'],
    };
    const [start, end] = palettes[config.template] ?? ['#f2aa21', '#6e2d91'];
    const gradient = context.createLinearGradient(0, 0, width, height);
    gradient.addColorStop(0, start); gradient.addColorStop(1, end);
    context.fillStyle = gradient; context.fillRect(0, 0, width, height);
    // Same still frame as renderStudioCanvas at phase 1: photo, edge shade for caption contrast, fire veil.
    const background = await imageBitmap(config.customImage);
    if (background) {
      cover(context, background, 0, 0, width, height, config.imageCrop); background.close();
      const overlay = context.createLinearGradient(0, 0, 0, height);
      overlay.addColorStop(0, 'rgba(8,6,4,.42)');
      overlay.addColorStop(0.24, 'rgba(8,6,4,0)');
      overlay.addColorStop(0.74, 'rgba(8,6,4,0)');
      overlay.addColorStop(1, 'rgba(8,6,4,.46)');
      context.fillStyle = overlay;
      context.fillRect(0, 0, width, height);
      if (config.effect === 'fire') {
        const flame = context.createLinearGradient(0, height, 0, height * 0.28);
        flame.addColorStop(0, 'rgba(255,72,0,0.32)');
        flame.addColorStop(0.45, 'rgba(255,160,20,0.144)');
        flame.addColorStop(1, 'rgba(255,200,40,0)');
        context.fillStyle = flame;
        context.fillRect(0, 0, width, height);
      }
    } else {
      context.globalAlpha = 0.14;
      for (let x = -height; x < width; x += 90) context.fillRect(x, 0, 34, height);
      context.globalAlpha = 1;
    }
    const website = await imageBitmap(config.websiteColumn ? String(contact[config.websiteColumn] ?? '') : '');
    if (website) {
      const zone = config.websiteZone;
      context.save(); context.beginPath(); context.roundRect(zone.x * width, zone.y * height, zone.width * width, zone.height * height, 24); context.clip();
      cover(context, website, zone.x * width, zone.y * height, zone.width * width, zone.height * height, config.imageCrop); context.restore(); website.close();
    }
    await loadCaptionFont();
    const measure = canvasCaptionMeasure(new OffscreenCanvas(1, 1).getContext('2d') ?? context);
    config.layers.forEach((layer) => drawCaptionLayer(context, layer, contact, width, height, width, height, measure));
  }
  return canvas.convertToBlob({ type: 'image/png' });
}

self.onmessage = async (event: MessageEvent<RenderMessage>) => {
  const { id, config, contact } = event.data;
  try {
    self.postMessage({ id, blob: await render(config, contact) });
  } catch (error) {
    self.postMessage({ id, error: error instanceof Error ? error.message : 'Worker rendering failed.' });
  }
};

export {};
