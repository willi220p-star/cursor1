/// <reference lib="webworker" />
import { publicAssetUrl } from '@/lib/public-url';
import { renderMerge } from './merge';
import type { Contact, StudioConfig, TextLayer } from './types';
import { coverCropRect } from './types';

type RenderMessage = { id: string; config: StudioConfig; contact: Contact };

const sizes = {
  A4: { width: 1240, height: 1754 },
  LinkedIn: { width: 1080, height: 1080 },
  Email: { width: 1200, height: 628 },
  Portrait: { width: 1080, height: 1350 },
  Widescreen: { width: 1600, height: 900 },
  Classic: { width: 800, height: 600 },
} as const;

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

function drawLayer(context: OffscreenCanvasRenderingContext2D, layer: TextLayer, contact: Contact, width: number, height: number) {
  const size = Math.max(18, layer.fontSize * (width / 1080));
  const x = layer.x * width;
  const y = layer.y * height;
  const maxWidth = layer.width * width;
  context.font = `900 ${size}px Impact, sans-serif`;
  context.textAlign = layer.align;
  context.textBaseline = 'top';
  context.fillStyle = layer.color;
  context.strokeStyle = '#111';
  context.lineJoin = 'round';
  context.lineWidth = Math.max(3, size * .1);
  const anchor = layer.align === 'center' ? x + maxWidth / 2 : layer.align === 'right' ? x + maxWidth : x;
  wrap(context, renderMerge(layer.text, contact), maxWidth).forEach((line, index) => {
    const lineY = y + index * size * 1.03;
    if (layer.outline) context.strokeText(line, anchor, lineY, maxWidth);
    context.fillText(line, anchor, lineY, maxWidth);
  });
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
    const copy = renderMerge(config.copy, contact);
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
    const background = await imageBitmap(config.customImage);
    if (background) { cover(context, background, 0, 0, width, height, config.imageCrop); background.close(); }
    const website = await imageBitmap(config.websiteColumn ? String(contact[config.websiteColumn] ?? '') : '');
    if (website) {
      const zone = config.websiteZone;
      context.save(); context.beginPath(); context.roundRect(zone.x * width, zone.y * height, zone.width * width, zone.height * height, 24); context.clip();
      cover(context, website, zone.x * width, zone.y * height, zone.width * width, zone.height * height); context.restore(); website.close();
    }
    config.layers.forEach((layer) => drawLayer(context, layer, contact, width, height));
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
