import { publicAssetUrl } from '@/lib/utils';
import type { AvatarShape, Contact, CropFocus, DeskSurface, NoteFinish, StudioConfig, StudioMode, TextLayer } from './types';
import { AVATAR_CACHE_FIELD, AVATAR_SOURCE_FIELD, canvasSizes, coverCropRect, defaultCrop, finishPaperZone, handwritingFonts, migrateDeskSurface, migrateWritingHand, writingHands, writingSpeedSpec } from './types';
import { renderMerge } from './merge';
import { loadArtefactFonts } from './fonts';
import { peekPortraitCache } from './portraits';

export const dimensions = canvasSizes;

const imageCache = new Map<string, Promise<HTMLImageElement | null>>();

async function loadImage(url?: string) {
  if (!url) return null;
  const resolved = publicAssetUrl(url);
  const source = peekPortraitCache(url) || peekPortraitCache(resolved) || resolved;
  const cached = imageCache.get(source);
  if (cached) return cached;
  const pending = decodeImage(source);
  imageCache.set(source, pending);
  const loaded = await pending;
  if (!loaded) imageCache.delete(source);
  return loaded;
}

function isInlineImageUrl(url: string) {
  return url.startsWith('data:') || url.startsWith('blob:') || url.startsWith('/');
}

function decodeHtmlImage(url: string, cors: boolean) {
  return new Promise<HTMLImageElement | null>((resolve) => {
    const image = new Image();
    if (cors) image.crossOrigin = 'anonymous';
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = url;
  });
}

async function decodeImage(url: string) {
  if (isInlineImageUrl(url)) return decodeHtmlImage(url, false);
  const corsImage = await decodeHtmlImage(url, true);
  if (corsImage) return corsImage;
  try {
    const response = await fetch(url, { mode: 'cors' });
    if (!response.ok) return null;
    const blob = await response.blob();
    if (!blob.type.startsWith('image/')) return null;
    const objectUrl = URL.createObjectURL(blob);
    const image = await decodeHtmlImage(objectUrl, false);
    if (!image) URL.revokeObjectURL(objectUrl);
    return image;
  } catch {
    return null;
  }
}

export async function probeImage(url?: string) {
  return Boolean(url && (await loadImage(url)));
}

function roundedRect(context: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number) {
  context.beginPath();
  context.roundRect(x, y, width, height, Math.max(0, radius));
}

function unitRand(seed: number, salt: number) {
  const value = Math.sin((seed + 1) * 12.9898 + salt * 78.233) * 43758.5453;
  return value - Math.floor(value);
}

function wrapLines(context: CanvasRenderingContext2D, text: string, width: number) {
  const lines: string[] = [];
  for (const paragraph of text.split('\n')) {
    const words = paragraph.split(/\s+/);
    let line = '';
    for (const word of words) {
      const next = line ? `${line} ${word}` : word;
      if (context.measureText(next).width > width && line) {
        lines.push(line);
        line = word;
      } else line = next;
    }
    lines.push(line);
  }
  return lines;
}

function drawImageCover(
  context: CanvasRenderingContext2D,
  image: HTMLImageElement,
  x: number,
  y: number,
  width: number,
  height: number,
  crop: CropFocus = defaultCrop,
) {
  const nw = image.naturalWidth || image.width || 320;
  const nh = image.naturalHeight || image.height || 400;
  const { sx, sy, sw, sh } = coverCropRect(nw, nh, width, height, crop);
  context.drawImage(image, sx, sy, sw, sh, x, y, width, height);
}

export function resolveAvatarSource(config: StudioConfig, contact: Contact) {
  const cached = String(contact[AVATAR_CACHE_FIELD] ?? '').trim();
  if (cached) return peekPortraitCache(cached) || publicAssetUrl(cached);
  const fromColumn = config.avatarColumn ? String(contact[config.avatarColumn] ?? '').trim() : '';
  if (fromColumn) return peekPortraitCache(fromColumn) || publicAssetUrl(fromColumn);
  const stored = String(contact[AVATAR_SOURCE_FIELD] ?? '').trim();
  if (stored) return peekPortraitCache(stored) || publicAssetUrl(stored);
  const url = config.avatarUrl?.trim();
  if (url) return peekPortraitCache(url) || publicAssetUrl(url);
  return publicAssetUrl(config.avatarImage?.trim() || '');
}

export function resolveMessage(config: StudioConfig, contact: Contact) {
  const fromColumn = config.messageColumn ? String(contact[config.messageColumn] ?? '').trim() : '';
  if (fromColumn) return fromColumn;
  return renderMerge(config.message || '', contact).trim();
}

function clipAvatarShape(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  shape: AvatarShape | undefined,
) {
  context.beginPath();
  if (shape === 'square') context.rect(x, y, width, height);
  else if (shape === 'rounded') context.roundRect(x, y, width, height, Math.min(width, height) * 0.16);
  else {
    const radius = Math.min(width, height) / 2;
    context.ellipse(x + width / 2, y + height / 2, radius, radius, 0, 0, Math.PI * 2);
  }
}

async function paintAvatarOnPaper(
  context: CanvasRenderingContext2D,
  config: StudioConfig,
  contact: Contact,
  width: number,
  height: number,
  scale: number,
) {
  const source = resolveAvatarSource(config, contact);
  const zone = config.avatarZone;
  const x = width * zone.x;
  const y = height * zone.y;
  const w = width * zone.width;
  const h = height * zone.height;
  const image = await loadImage(source);
  context.save();
  clipAvatarShape(context, x, y, w, h, config.avatarShape);
  context.clip();
  if (image) {
    drawImageCover(context, image, x, y, w, h, config.avatarCrop ?? defaultCrop);
  } else {
    const fill = context.createLinearGradient(x, y, x + w, y + h);
    fill.addColorStop(0, '#d9b48a');
    fill.addColorStop(1, '#8a5a32');
    context.fillStyle = fill;
    context.fillRect(x, y, w, h);
    const initials = String(contact.first_name || contact.company || 'DG')
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part[0] ?? '')
      .join('')
      .toUpperCase();
    context.fillStyle = '#fff8ee';
    context.font = `700 ${Math.max(22, Math.min(w, h) * 0.28)}px "Space Grotesk", sans-serif`;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(initials || '•', x + w / 2, y + h / 2);
  }
  context.restore();
  context.save();
  context.strokeStyle = 'rgba(40, 28, 16, 0.16)';
  context.lineWidth = 1.6 * scale;
  clipAvatarShape(context, x, y, w, h, config.avatarShape);
  context.stroke();
  context.restore();
}

function writingHandSpec(config: StudioConfig) {
  const id = migrateWritingHand(config.writingHand);
  return writingHands.find((item) => item.id === id) ?? writingHands[0];
}

export const deskTextureUrls: Record<Exclude<DeskSurface, 'custom'>, string> = {
  pine: publicAssetUrl('/desk/pine.png'),
  oak: publicAssetUrl('/desk/oak.png'),
  walnut: publicAssetUrl('/desk/walnut.png'),
  maple: publicAssetUrl('/desk/maple.png'),
  mahogany: publicAssetUrl('/desk/mahogany.png'),
};

function paintDeskSurface(
  context: CanvasRenderingContext2D,
  surface: DeskSurface | undefined,
  width: number,
  height: number,
  scale: number,
  seed: number,
  deskColor?: string,
  woodPhoto?: HTMLImageElement | null,
) {
  const kind = migrateDeskSurface(surface);
  if (kind !== 'custom' && woodPhoto) {
    drawImageCover(context, woodPhoto, 0, 0, width, height, defaultCrop);
    context.fillStyle = kind === 'walnut' || kind === 'mahogany' ? 'rgba(20,10,4,.14)' : 'rgba(40,22,8,.05)';
    context.fillRect(0, 0, width, height);
    return;
  }
  if (kind === 'custom') {
    context.fillStyle = deskColor || '#c08a4a';
    context.fillRect(0, 0, width, height);
    context.fillStyle = 'rgba(0,0,0,.05)';
    for (let i = 0; i < 40; i++) {
      context.fillRect(0, ((i * 47 + seed) % height), width, 1.2 * scale);
    }
    return;
  }
  if (kind === 'walnut') {
    const fill = context.createLinearGradient(0, 0, width, height);
    fill.addColorStop(0, '#4a2814');
    fill.addColorStop(1, '#2c160a');
    context.fillStyle = fill;
    context.fillRect(0, 0, width, height);
    context.strokeStyle = 'rgba(18, 8, 3, .28)';
    context.lineWidth = 2.2 * scale;
    for (let i = 0; i < 18; i++) {
      const y = ((i * 61 + seed) % height);
      context.beginPath();
      context.moveTo(0, y);
      context.bezierCurveTo(width * 0.25, y + 8 * scale, width * 0.6, y - 10 * scale, width, y + 4 * scale);
      context.stroke();
    }
    return;
  }
  if (kind === 'oak') {
    context.fillStyle = '#d6ae76';
    context.fillRect(0, 0, width, height);
    context.strokeStyle = 'rgba(140, 90, 36, .22)';
    context.lineWidth = 1.6 * scale;
    for (let i = 0; i < 22; i++) {
      const y = i * 18 * scale + (unitRand(seed, i) - 0.5) * 6 * scale;
      context.beginPath();
      context.moveTo(0, y);
      context.bezierCurveTo(width * 0.4, y + 5 * scale, width * 0.7, y - 4 * scale, width, y);
      context.stroke();
    }
    return;
  }
  if (kind === 'maple') {
    const fill = context.createLinearGradient(0, 0, width, height);
    fill.addColorStop(0, '#f0d7a4');
    fill.addColorStop(1, '#d8b06a');
    context.fillStyle = fill;
    context.fillRect(0, 0, width, height);
    context.strokeStyle = 'rgba(160, 110, 40, .16)';
    context.lineWidth = 1.4 * scale;
    for (let i = 0; i < 20; i++) {
      const y = i * 16 * scale + unitRand(seed, i + 8) * 6 * scale;
      context.beginPath();
      context.moveTo(0, y);
      context.bezierCurveTo(width * 0.35, y + 4 * scale, width * 0.7, y - 3 * scale, width, y + 2 * scale);
      context.stroke();
    }
    return;
  }
  if (kind === 'mahogany') {
    const fill = context.createLinearGradient(0, 0, width, height);
    fill.addColorStop(0, '#7a2e1c');
    fill.addColorStop(1, '#4a160c');
    context.fillStyle = fill;
    context.fillRect(0, 0, width, height);
    context.strokeStyle = 'rgba(20, 6, 4, .28)';
    context.lineWidth = 2 * scale;
    for (let i = 0; i < 16; i++) {
      const y = ((i * 71 + seed) % height);
      context.beginPath();
      context.moveTo(0, y);
      context.bezierCurveTo(width * 0.3, y + 6 * scale, width * 0.65, y - 8 * scale, width, y + 3 * scale);
      context.stroke();
    }
    return;
  }
  const pine = context.createLinearGradient(0, 0, 0, height);
  pine.addColorStop(0, '#c89252');
  pine.addColorStop(1, '#b07a3e');
  context.fillStyle = pine;
  context.fillRect(0, 0, width, height);
  context.strokeStyle = 'rgba(90,48,16,.2)';
  context.lineWidth = 2 * scale;
  for (let i = 0; i < 16; i++) {
    const y = i * 14 * scale + unitRand(seed, i + 4) * 8 * scale;
    context.beginPath();
    context.moveTo(0, y);
    context.bezierCurveTo(width * 0.3, y + 6 * scale, width * 0.65, y - 5 * scale, width, y + 3 * scale);
    context.stroke();
  }
}

function pickFrom<T>(items: readonly T[], seed: number) {
  return items[Math.abs(seed) % items.length] as T;
}

function paperColorFor(config: StudioConfig) {
  if (config.paperColorPreset === 'white') return '#ffffff';
  if (config.paperColorPreset === 'cream') return '#f7f0e1';
  if (config.paperColorPreset === 'watercolour') return config.paperColor || '#f3ebe3';
  return config.paperColor || '#f7f0e1';
}

function paintWatercolour(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  seed: number,
  scale: number,
) {
  const washes = ['rgba(186, 214, 232, .22)', 'rgba(244, 196, 186, .18)', 'rgba(232, 214, 164, .16)', 'rgba(196, 186, 222, .14)'];
  context.save();
  for (let i = 0; i < 9; i++) {
    const cx = x + unitRand(seed, i + 20) * width;
    const cy = y + unitRand(seed, i + 40) * height;
    const radius = (90 + unitRand(seed, i + 60) * 140) * scale;
    const blob = context.createRadialGradient(cx, cy, 4 * scale, cx, cy, radius);
    blob.addColorStop(0, washes[i % washes.length]);
    blob.addColorStop(1, 'rgba(255,255,255,0)');
    context.fillStyle = blob;
    context.beginPath();
    context.arc(cx, cy, radius, 0, Math.PI * 2);
    context.fill();
  }
  context.restore();
}

function paintPaperGrain(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  seed: number,
  scale: number,
) {
  context.save();
  for (let i = 0; i < 520; i++) {
    const px = x + unitRand(seed, i) * width;
    const py = y + unitRand(seed, i + 800) * height;
    context.fillStyle = unitRand(seed, i + 3) > 0.5 ? 'rgba(70,50,30,.05)' : 'rgba(255,255,255,.06)';
    context.fillRect(px, py, 1.4 * scale, 1.4 * scale);
  }
  context.strokeStyle = 'rgba(110,80,45,.045)';
  context.lineWidth = 0.7 * scale;
  for (let i = 0; i < 48; i++) {
    const sx = x + unitRand(seed, i + 40) * width;
    const sy = y + unitRand(seed, i + 80) * height;
    context.beginPath();
    context.moveTo(sx, sy);
    context.lineTo(sx + (10 + unitRand(seed, i) * 18) * scale, sy + (unitRand(seed, i + 1) - 0.5) * 7 * scale);
    context.stroke();
  }
  context.restore();
}

function paperBackground(
  context: CanvasRenderingContext2D,
  config: StudioConfig,
  x: number,
  y: number,
  width: number,
  height: number,
  scale: number,
  seed: number,
) {
  const kind = config.paperKind ?? (config.template === 'Diary' || config.template === 'diary' ? 'diary' : config.template?.includes('White') ? 'white-paper' : 'notebook');
  context.fillStyle = paperColorFor(config);
  context.fillRect(x, y, width, height);
  if (config.paperColorPreset === 'watercolour') {
    paintWatercolour(context, x, y, width, height, seed, scale);
  }
  if (kind !== 'white-paper' || config.paperColorPreset === 'watercolour') {
    paintPaperGrain(context, x, y, width, height, seed, scale * (kind === 'white-paper' ? 0.45 : 1));
  } else {
    paintPaperGrain(context, x, y, width, height, seed, scale * 0.35);
  }

  if (kind === 'diary') {
    context.fillStyle = 'rgba(40, 24, 16, .14)';
    context.fillRect(x, y, 22 * scale, height);
    context.fillStyle = 'rgba(255,255,255,.35)';
    context.fillRect(x + 22 * scale, y, 3 * scale, height);
    context.fillStyle = 'rgba(40,28,16,.55)';
    context.font = `600 ${18 * scale}px "Space Grotesk", sans-serif`;
    context.textBaseline = 'alphabetic';
    context.fillText('Date', x + 48 * scale, y + 46 * scale);
    context.strokeStyle = 'rgba(40,28,16,.45)';
    context.lineWidth = 1.4 * scale;
    context.beginPath();
    context.moveTo(x + 96 * scale, y + 48 * scale);
    context.lineTo(x + 280 * scale, y + 48 * scale);
    context.stroke();
    context.beginPath();
    context.moveTo(x + 48 * scale, y + 58 * scale);
    context.lineTo(x + width - 40 * scale, y + 58 * scale);
    context.stroke();
  }

  if (kind === 'notebook') {
    context.fillStyle = 'rgba(210, 214, 220, .55)';
    for (let i = 0; i < 8; i++) {
      const cy = y + 70 * scale + i * ((height - 120 * scale) / 7);
      context.beginPath();
      context.arc(x + 22 * scale, cy, 6 * scale, 0, Math.PI * 2);
      context.fill();
      context.fillStyle = 'rgba(255,255,255,.7)';
      context.beginPath();
      context.arc(x + 22 * scale, cy, 3.2 * scale, 0, Math.PI * 2);
      context.fill();
      context.fillStyle = 'rgba(210, 214, 220, .55)';
    }
  }

  const lined = config.ruledLines ?? kind !== 'white-paper';
  if (lined) {
    context.strokeStyle = kind === 'diary' ? 'rgba(73,120,170,.12)' : 'rgba(73,120,170,.22)';
    context.lineWidth = 1.35 * scale;
    context.lineCap = 'round';
    const top = y + (kind === 'diary' ? 78 : 92) * scale;
    const step = 36 * scale;
    for (let lineY = top; lineY < y + height - 28 * scale; lineY += step) {
      const wobble = kind === 'white-paper' ? 0 : (unitRand(seed, Math.round(lineY)) - 0.5) * 2.4 * scale;
      context.beginPath();
      context.moveTo(x + (kind === 'notebook' ? 52 : 44) * scale, lineY + wobble);
      context.bezierCurveTo(
        x + width * 0.35,
        lineY + wobble * 0.4,
        x + width * 0.7,
        lineY - wobble,
        x + width - 36 * scale,
        lineY + wobble * 0.2,
      );
      context.stroke();
    }
  }
  const margin = config.showMargin ?? kind === 'notebook';
  if (margin) {
    context.strokeStyle = 'rgba(196,64,64,.32)';
    context.lineWidth = 1.5 * scale;
    context.beginPath();
    const mx = x + 78 * scale;
    context.moveTo(mx, y + 8 * scale);
    context.bezierCurveTo(mx + 2 * scale, y + height * 0.4, mx - 3 * scale, y + height * 0.7, mx + 1 * scale, y + height - 8 * scale);
    context.stroke();
  }
}

function paintDogEar(
  context: CanvasRenderingContext2D,
  paperX: number,
  paperY: number,
  paperW: number,
  scale: number,
  seed: number,
) {
  if (unitRand(seed, 19) < 0.42) return;
  const size = 26 * scale;
  context.save();
  context.beginPath();
  context.moveTo(paperX + paperW - size, paperY);
  context.lineTo(paperX + paperW, paperY);
  context.lineTo(paperX + paperW, paperY + size);
  context.closePath();
  context.fillStyle = 'rgba(40,28,16,.1)';
  context.fill();
  context.beginPath();
  context.moveTo(paperX + paperW - size, paperY);
  context.lineTo(paperX + paperW - size * 0.12, paperY + size * 0.88);
  context.lineTo(paperX + paperW, paperY + size);
  context.closePath();
  context.fillStyle = 'rgba(255,250,240,.55)';
  context.fill();
  context.restore();
}

function botchedWord(word: string, salt: number) {
  const letters = word.replace(/[^A-Za-z]/g, '');
  if (letters.length < 3) return `${word}${word[word.length - 1] ?? ''}`;
  const lower = letters.toLowerCase();
  if (lower === 'the') return word.replace(/the/i, word[0] === 'T' ? 'Teh' : 'teh');
  if (lower === 'and') return word.replace(/and/i, word[0] === 'A' ? 'Adn' : 'adn');
  if (lower === 'your') return word.replace(/your/i, word[0] === 'Y' ? 'Yuor' : 'yuor');
  if (lower === 'with') return word.replace(/with/i, word[0] === 'W' ? 'Wiht' : 'wiht');
  const i = 1 + (Math.abs(salt) % Math.max(1, letters.length - 2));
  if (salt % 2 === 0) return word.slice(0, i) + word[i] + word.slice(i);
  return word.slice(0, i) + word.slice(i + 1);
}

function strikeThrough(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  fontSize: number,
  unit: number,
  seed: number,
  salt: number,
) {
  context.save();
  context.globalAlpha = 0.88;
  context.lineCap = 'round';
  context.lineJoin = 'round';
  for (let pass = 0; pass < 2; pass++) {
    context.lineWidth = Math.max(2.2, fontSize * (0.09 + pass * 0.03));
    context.beginPath();
    const mid = y + fontSize * (0.36 + pass * 0.1) + (unitRand(seed, salt + pass) - 0.5) * 3 * unit;
    context.moveTo(x - 4, mid);
    const bump = (unitRand(seed, salt + 4 + pass) - 0.5) * fontSize * 0.22 * unit;
    context.quadraticCurveTo(x + width * 0.5, mid + bump, x + width + 5, mid + (unitRand(seed, salt + 8 + pass) - 0.5) * 3);
    context.stroke();
  }
  context.restore();
}

function drawInkWord(
  context: CanvasRenderingContext2D,
  word: string,
  x: number,
  y: number,
  fontSize: number,
  fontFamily: string,
  seed: number,
  salt: number,
  unit: number,
  extraTracking: number,
) {
  const size = fontSize * (1 + (unitRand(seed, salt) - 0.5) * 0.14 * unit);
  const dy = (unitRand(seed, salt + 1) - 0.5) * Math.max(fontSize * 0.18, 4.5) * unit;
  const rot = (unitRand(seed, salt + 2) - 0.5) * 0.09 * unit;
  context.save();
  context.font = `${size}px "${fontFamily}", "Homemade Apple", Caveat, cursive`;
  context.globalAlpha *= 0.78 + 0.22 * unitRand(seed, salt + 9);
  context.translate(x, y + dy);
  context.rotate(rot);
  context.scale(0.97 + unitRand(seed, salt + 6) * 0.07 * unit, 1);
  context.fillText(word, 0, 0);
  const width = context.measureText(word).width;
  context.restore();
  if (unit > 0.38 && unitRand(seed, salt * 71) < 0.22 * unit) {
    context.save();
    context.globalAlpha *= 0.45 * unit;
    context.beginPath();
    context.ellipse(
      x + width * 0.55,
      y + fontSize * 0.78,
      Math.max(1.4, fontSize * 0.045),
      Math.max(1, fontSize * 0.03),
      rot,
      0,
      Math.PI * 2,
    );
    context.fill();
    context.restore();
  }
  return width + extraTracking * word.length * 0.15;
}

function realismAngle(seed: number, realism: number) {
  const unit = ((seed * 9301 + 49297) % 233280) / 233280;
  return (unit - 0.5) * 5.2 * (realism / 100);
}

function highlightWords(value?: string) {
  return (value ?? '').split(/[,]+/).map((item) => item.trim().toLowerCase()).filter(Boolean);
}

function wordMatches(word: string, tokens: string[]) {
  const clean = word.replace(/[^\w'-]/g, '').toLowerCase();
  return Boolean(clean) && tokens.some((token) => token === clean || clean.includes(token) || token.includes(clean));
}

function colorWithAlpha(hex: string, alpha: number) {
  const raw = hex.replace('#', '').trim();
  const full = raw.length === 3 ? raw.split('').map((part) => part + part).join('') : raw;
  const r = Number.parseInt(full.slice(0, 2), 16);
  const g = Number.parseInt(full.slice(2, 4), 16);
  const b = Number.parseInt(full.slice(4, 6), 16);
  if ([r, g, b].some((part) => Number.isNaN(part))) return `rgba(255, 214, 102, ${alpha})`;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function contactFieldValue(contact: Contact, key: string) {
  if (!key || key === 'row') return '';
  const exact = contact[key];
  if (exact !== undefined && String(exact).trim()) return String(exact).trim();
  const match = Object.keys(contact).find((item) => item.toLowerCase() === key.toLowerCase());
  if (!match || match === 'row') return '';
  return String(contact[match] ?? '').trim();
}

function expandHighlightNeedles(raw: string, contact: Contact) {
  const needles = new Set<string>();
  for (const token of highlightWords(raw)) {
    const key = token.replace(/[{}]/g, '').trim();
    if (key.length >= 2) needles.add(key);
    const value = contactFieldValue(contact, key);
    if (value) {
      needles.add(value.toLowerCase());
      for (const part of value.toLowerCase().split(/\s+/)) {
        const clean = part.replace(/[^\w'-]/g, '');
        if (clean.length >= 2) needles.add(clean);
      }
    }
  }
  return [...needles].sort((a, b) => b.length - a.length);
}

function highlightRanges(line: string, needles: string[]) {
  if (!line || !needles.length) return [] as Array<{ start: number; end: number }>;
  const lower = line.toLowerCase();
  const taken = new Array(line.length).fill(false);
  const ranges: Array<{ start: number; end: number }> = [];
  for (const needle of needles) {
    if (needle.length < 2) continue;
    let from = 0;
    while (from < lower.length) {
      const index = lower.indexOf(needle, from);
      if (index < 0) break;
      const end = index + needle.length;
      const edgeStart = index === 0 || !/[\w']/.test(line[index - 1] ?? '');
      const edgeEnd = end >= line.length || !/[\w']/.test(line[end] ?? '');
      const free = !taken.slice(index, end).some(Boolean);
      if (edgeStart && edgeEnd && free) {
        ranges.push({ start: index, end });
        taken.fill(true, index, end);
      }
      from = index + 1;
    }
  }
  return ranges.sort((a, b) => a.start - b.start);
}

function drawMarkerStroke(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  fontSize: number,
  color: string,
) {
  if (width < 0.8) return;
  context.save();
  context.fillStyle = color;
  const pad = Math.max(2, fontSize * 0.1);
  const top = y + fontSize * 0.06;
  const height = fontSize * 0.96;
  context.beginPath();
  context.roundRect(x - pad, top, width + pad * 2, height, Math.min(5, fontSize * 0.22));
  context.fill();
  context.restore();
}

function sliceTyped(text: string, phase: number, animation?: string) {
  if (animation !== 'type') return text;
  const t = Math.max(0, Math.min(1, phase));
  return text.slice(0, Math.max(0, Math.floor(text.length * t)));
}

function glyphCost(ch: string) {
  if (ch === '\n') return 0.55;
  if (/\s/.test(ch)) return 0.28;
  if (/[.,;:!?'"]/.test(ch)) return 0.4;
  if (/[mMwW]/.test(ch)) return 1.24;
  if (/[ijlI]/.test(ch)) return 0.7;
  if (/[A-Z]/.test(ch)) return 1.16;
  return 1;
}

function writingCost(text: string) {
  let total = 0;
  for (const ch of text) total += glyphCost(ch);
  return Math.max(0.01, total);
}

function drawLayer(context: CanvasRenderingContext2D, layer: TextLayer, contact: Contact, width: number, height: number, phase = 1) {
  const x = layer.x * width;
  const y = layer.y * height;
  const maxWidth = layer.width * width;
  const size = Math.max(18, layer.fontSize * (width / 1080));
  const animation = layer.animation ?? 'still';
  const pop = animation === 'pop' ? (phase < 0.45 ? 0.55 + phase * 1.2 : 1) : 1;
  context.save();
  if (animation === 'still' || animation === 'highlight') context.globalAlpha = phase;
  else context.globalAlpha = 1;
  if (layer.boxFill) {
    context.fillStyle = layer.boxFill;
    context.globalAlpha *= 0.88;
    context.fillRect(x, y, maxWidth, layer.height * height);
    context.globalAlpha = 1;
  }
  const cx = x + maxWidth / 2;
  const cy = y + (layer.height * height) / 2;
  context.translate(cx, cy);
  context.scale(pop, pop);
  context.translate(-cx, -cy);
  context.font = `900 ${size}px Anton, Impact, sans-serif`;
  context.textAlign = layer.align;
  context.textBaseline = 'top';
  context.fillStyle = layer.color;
  context.strokeStyle = '#0b0b0b';
  context.lineJoin = 'round';
  context.miterLimit = 2;
  if (animation === 'glow') {
    context.shadowColor = layer.highlightColor || layer.color;
    context.shadowBlur = 10 + 22 * Math.abs(Math.sin(phase * Math.PI * 2));
  }
  const merged = sliceTyped(renderMerge(layer.text, contact), phase, animation);
  const tokens = highlightWords(layer.highlight);
  const marker = layer.highlightColor || '#ffe566';
  const anchor = layer.align === 'center' ? x + maxWidth / 2 : layer.align === 'right' ? x + maxWidth : x;
  const lines = wrapLines(context, merged, maxWidth);
  lines.forEach((line, index) => {
    const lineY = y + index * size * 1.02;
    if (animation === 'highlight') {
      context.save();
      context.fillStyle = marker;
      context.globalAlpha = 0.72;
      const painted = Math.max(8, context.measureText(line).width * Math.max(0.08, phase));
      const left = layer.align === 'center' ? anchor - painted / 2 : layer.align === 'right' ? anchor - painted : anchor;
      context.fillRect(left - 6, lineY + size * 0.55, painted + 12, size * 0.38);
      context.restore();
    }
    if (tokens.length) {
      const words = line.split(/(\s+)/);
      const total = context.measureText(line).width;
      let cursor = layer.align === 'center' ? anchor - total / 2 : layer.align === 'right' ? anchor - total : anchor;
      context.textAlign = 'left';
      words.forEach((chunk) => {
        const widthChunk = context.measureText(chunk).width;
        if (wordMatches(chunk, tokens)) {
          context.fillStyle = marker;
          context.globalAlpha = 0.8;
          context.fillRect(cursor - 3, lineY + size * 0.12, widthChunk + 6, size * 0.92);
          context.globalAlpha = 1;
          context.fillStyle = layer.color;
        }
        if (layer.outline) {
          context.lineWidth = Math.max(8, size * 0.16);
          context.strokeText(chunk, cursor, lineY);
          context.lineWidth = Math.max(4, size * 0.09);
          context.strokeText(chunk, cursor, lineY);
        }
        context.fillText(chunk, cursor, lineY);
        cursor += widthChunk;
      });
      context.textAlign = layer.align;
      return;
    }
    if (layer.outline) {
      context.lineWidth = Math.max(8, size * 0.16);
      context.strokeText(line, anchor, lineY, maxWidth);
      context.lineWidth = Math.max(4, size * 0.09);
      context.strokeText(line, anchor, lineY, maxWidth);
    }
    context.fillText(line, anchor, lineY, maxWidth);
  });
  context.restore();
}

function drawWritingHandPhoto(
  context: CanvasRenderingContext2D,
  image: HTMLImageElement,
  x: number,
  y: number,
  paperW: number,
  scale: number,
  seed: number,
  tip: { x: number; y: number },
  motion: { tilt?: number; lift?: number; phase?: number } = {},
) {
  const phase = motion.phase ?? 0;
  const scribble = phase * 36 + seed * 0.01;
  const wobbleX = Math.sin(scribble * 2.15) * 1.8 * scale;
  const wobbleY = Math.cos(scribble * 3.4) * 1.15 * scale + (unitRand(seed, Math.floor(x + y)) - 0.5) * 1.2 * scale;
  const destW = Math.max(168 * scale, paperW * 0.34);
  const destH = destW * ((image.naturalHeight || image.height) / (image.naturalWidth || image.width || 1));
  context.save();
  context.shadowColor = 'rgba(18, 12, 8, 0.22)';
  context.shadowBlur = (12 + (motion.lift ?? 0) * 0.2) * scale;
  context.shadowOffsetY = (6 + (motion.lift ?? 0) * 0.15) * scale;
  context.translate(x + wobbleX, y + wobbleY);
  context.rotate(motion.tilt ?? -0.08);
  context.drawImage(image, -destW * tip.x, (motion.lift ?? 0) - destH * tip.y, destW, destH);
  context.restore();
}

function drawWritingPen(context: CanvasRenderingContext2D, x: number, y: number, scale: number, seed: number) {
  const wobble = (unitRand(seed, Math.floor(x + y)) - 0.5) * 2.2 * scale;
  const s = scale;
  context.save();
  context.translate(x, y + wobble);
  context.rotate(-0.62);
  context.fillStyle = 'rgba(24, 14, 8, 0.2)';
  context.beginPath();
  context.ellipse(38 * s, 52 * s, 36 * s, 12 * s, 0.2, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = '#2a3d68';
  context.beginPath();
  context.moveTo(22 * s, 18 * s);
  context.quadraticCurveTo(58 * s, 28 * s, 92 * s, 78 * s);
  context.lineTo(68 * s, 92 * s);
  context.quadraticCurveTo(40 * s, 44 * s, 14 * s, 32 * s);
  context.closePath();
  context.fill();
  context.fillStyle = '#f4efe6';
  context.beginPath();
  context.moveTo(16 * s, 16 * s);
  context.quadraticCurveTo(36 * s, 22 * s, 42 * s, 36 * s);
  context.lineTo(28 * s, 44 * s);
  context.quadraticCurveTo(18 * s, 28 * s, 8 * s, 24 * s);
  context.closePath();
  context.fill();
  context.fillStyle = '#d7a57a';
  context.beginPath();
  context.ellipse(16 * s, 20 * s, 15 * s, 12 * s, -0.35, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = '#c48b62';
  context.beginPath();
  context.ellipse(20 * s, 24 * s, 11 * s, 9 * s, -0.2, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = '#e3b48a';
  context.beginPath();
  context.ellipse(8 * s, 8 * s, 7 * s, 11 * s, -1.05, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = '#f3d2b0';
  context.beginPath();
  context.ellipse(5 * s, 2 * s, 3.4 * s, 4.2 * s, -1.05, 0, Math.PI * 2);
  context.fill();
  const fingers = [
    { x: 3, y: -2, rot: -0.28, len: 22, w: 6.4 },
    { x: 9, y: -5, rot: -0.1, len: 24, w: 6.6 },
    { x: 15, y: -3, rot: 0.08, len: 22, w: 6.2 },
    { x: 20, y: 2, rot: 0.22, len: 18, w: 5.6 },
  ];
  fingers.forEach((finger) => {
    context.save();
    context.translate(finger.x * s, finger.y * s);
    context.rotate(finger.rot);
    context.fillStyle = '#d6a47c';
    context.beginPath();
    context.roundRect(-finger.w * 0.5 * s, -finger.len * s, finger.w * s, finger.len * s, 3.4 * s);
    context.fill();
    context.fillStyle = '#f0d0b0';
    context.beginPath();
    context.roundRect(-finger.w * 0.36 * s, -finger.len * s - 1.4 * s, finger.w * 0.72 * s, 5 * s, 1.8 * s);
    context.fill();
    context.restore();
  });
  context.fillStyle = '#1b3f72';
  context.beginPath();
  context.moveTo(-2 * s, 4 * s);
  context.lineTo(10 * s, -54 * s);
  context.lineTo(16.4 * s, -52 * s);
  context.lineTo(3.8 * s, 7 * s);
  context.closePath();
  context.fill();
  context.fillStyle = '#c9a36a';
  context.fillRect(10 * s, -62 * s, 6.6 * s, 12 * s);
  context.fillStyle = '#ece3cc';
  context.fillRect(10.4 * s, -68 * s, 5.8 * s, 7 * s);
  context.fillStyle = '#8d7350';
  context.fillRect(11.2 * s, -70 * s, 4.2 * s, 3 * s);
  context.strokeStyle = 'rgba(255,255,255,.38)';
  context.lineWidth = 1.2 * s;
  context.beginPath();
  context.moveTo(12.6 * s, -46 * s);
  context.lineTo(4 * s, -6 * s);
  context.stroke();
  context.fillStyle = '#0d1c33';
  context.beginPath();
  context.moveTo(0, 0);
  context.lineTo(2.4 * s, 9 * s);
  context.lineTo(5.2 * s, 1 * s);
  context.closePath();
  context.fill();
  context.fillStyle = 'rgba(40, 24, 12, 0.35)';
  context.beginPath();
  context.ellipse(1.6 * s, 1.2 * s, 2.4 * s, 1.1 * s, 0.4, 0, Math.PI * 2);
  context.fill();
  context.restore();
}

function drawHandwriting(
  context: CanvasRenderingContext2D,
  config: StudioConfig,
  contact: Contact,
  paperX: number,
  paperY: number,
  paperW: number,
  paperH: number,
  fontFamily: string,
  seed: number,
  scale: number,
  animationPhase: number,
  signatureImage?: CanvasImageSource | null,
  writingHand?: HTMLImageElement | null,
): { x: number; y: number; show: boolean; lift: number; tilt: number } {
  const kind = config.handwritingKind ?? 'errors';
  const wantErrors = kind === 'errors' || kind === 'messy';
  const wantUneven = kind === 'uneven' || kind === 'messy';
  const wantNeat = kind === 'neat';
  const unit = wantNeat ? Math.min((config.realism ?? 40) / 100, 0.2) : (config.realism ?? 70) / 100;
  const uneven = wantUneven ? Math.max(unit, 0.72) : unit;
  const fontSize = config.fontSize * scale;
  const extraTracking = (config.letterSpacing ?? 0) * scale;
  const copy = renderMerge(config.copy, contact);
  const postscript = config.postscript ? renderMerge(config.postscript, contact) : '';
  const writing = config.mode === 'handgif';
  const fullText = `${copy}${config.signature ? renderMerge(config.signature, contact) : ''}${postscript}`;
  const reveal = writing ? Math.max(0, Math.min(1, (animationPhase - 0.04) / 0.88)) : 1;
  const budget = writing ? { left: writingCost(fullText) * reveal } : null;
  let pen = {
    x: paperX + paperW * config.noteX,
    y: paperY + config.noteY * paperH + fontSize * 0.4,
    show: writing && reveal > 0 && reveal < 0.97,
    lift: 10 * scale,
    tilt: -0.16,
  };
  context.save();
  if (!writing) context.globalAlpha = animationPhase;
  context.fillStyle = config.inkColor;
  context.strokeStyle = config.inkColor;
  context.textBaseline = 'top';
  context.font = `${fontSize}px "${fontFamily}", "Homemade Apple", Caveat, cursive`;
  const maxWidth = paperW * 0.74;

  const takeChars = (word: string, trailingSpace = false) => {
    if (!budget) return word;
    if (budget.left <= 0) return '';
    let shown = '';
    for (const ch of word) {
      const cost = glyphCost(ch);
      if (shown && budget.left < cost * 0.4) break;
      if (budget.left <= 0) break;
      budget.left -= cost;
      shown += ch;
    }
    if (shown === word && trailingSpace && budget.left > 0) budget.left -= glyphCost(' ');
    return shown;
  };

  const paintLines = (text: string, startY: number, allowMistakes: boolean, lineSalt: number) => {
    const lines = wrapLines(context, text, maxWidth);
    const mistakeSlots = new Set<string>();
    if (allowMistakes && wantErrors) {
      const mistakeBudget = 1 + Math.floor(unit * 2);
      const candidates: string[] = [];
      lines.forEach((line, lineIndex) => {
        if (lineIndex === 0) return;
        line.split(/\s+/).forEach((word, wordIndex) => {
          if (word.length > 3) candidates.push(`${lineIndex}:${wordIndex}`);
        });
      });
      for (let i = 0; i < mistakeBudget && candidates.length; i++) {
        const pick = Math.floor(unitRand(seed, 211 + i + lineSalt) * candidates.length);
        mistakeSlots.add(candidates.splice(pick, 1)[0]);
      }
    }
    lines.forEach((line, lineIndex) => {
      const words = line ? line.split(/\s+/) : [''];
      const lineJitterX = wantNeat ? 0 : (unitRand(seed, lineIndex + 11 + lineSalt) - 0.5) * (wantUneven ? 28 : 12) * scale * uneven;
      const lineJitterY = wantNeat
        ? 0
        : (unitRand(seed, lineIndex + 17 + lineSalt) - 0.5) * (wantUneven ? 26 : 3.8) * scale * uneven;
      const slope = wantUneven ? lineIndex * 9 * scale * uneven : 0;
      const lineRot = wantNeat
        ? 0
        : ((unitRand(seed, lineIndex + 23 + lineSalt) - 0.5) * (wantUneven ? 5.2 : 1.8) * uneven * Math.PI) / 180;
      let cursor = paperX + paperW * config.noteX + lineJitterX;
      const drawY = startY + lineIndex * fontSize * config.lineSpacing + lineJitterY + slope;
      let baseline = 0;
      context.save();
      context.translate(cursor, drawY);
      context.rotate(lineRot);
      context.translate(-cursor, -drawY);
      words.forEach((word, wordIndex) => {
        if (!word) return;
        const visible = takeChars(word, wordIndex < words.length - 1);
        if (!visible) {
          if (writing && budget && budget.left <= 0 && pen.show) pen = { ...pen, lift: 12 * scale };
          return;
        }
        const salt = lineIndex * 97 + wordIndex * 13 + seed + lineSalt;
        const gap = fontSize * (0.34 + (unitRand(seed, salt) - 0.5) * (wantNeat ? 0.02 : 0.14) * unit);
        baseline += wantUneven ? (unitRand(seed, salt + 21) - 0.5) * fontSize * 0.16 * uneven : (unitRand(seed, salt + 21) - 0.5) * fontSize * 0.08 * unit;
        baseline *= wantUneven ? 0.92 : 0.72;
        const wordY = drawY + baseline;
        if (mistakeSlots.has(`${lineIndex}:${wordIndex}`) && visible === word) {
          context.save();
          context.globalAlpha *= 0.62;
          const wrong = botchedWord(word, salt);
          const wrongWidth = drawInkWord(
            context,
            wrong,
            cursor,
            wordY,
            fontSize * 0.97,
            fontFamily,
            seed,
            salt + 8,
            unit,
            extraTracking,
          );
          context.restore();
          strikeThrough(context, cursor, wordY, wrongWidth, fontSize, unit, seed, salt);
          cursor += wrongWidth + Math.max(gap, fontSize * 0.42);
        }
        const width = drawInkWord(context, visible, cursor, wordY, fontSize, fontFamily, seed, salt, wantNeat ? unit * 0.4 : unit, extraTracking);
        const nibX = cursor + Math.max(width * 0.88, width - fontSize * 0.12);
        const across = (nibX - paperX) / Math.max(1, paperW);
        const lifting = visible !== word ? 0 : 8 * scale;
        cursor += width + (visible === word ? gap : 0);
        pen = {
          x: nibX,
          y: wordY + fontSize * 0.38,
          show: writing && reveal < 0.97,
          lift: lifting,
          tilt: -0.2 + across * 0.26,
        };
      });
      context.restore();
    });
    return startY + Math.max(1, lines.length) * fontSize * config.lineSpacing;
  };

  let cursorY = paperY + config.noteY * paperH;
  cursorY = paintLines(copy, cursorY, true, 0);

  if (config.signature || signatureImage) {
    cursorY += fontSize * 0.35;
    const sigSize = Math.max(34, config.fontSize * 1.18) * scale;
    const sigX = paperX + paperW * 0.52 + (unitRand(seed, 77) - 0.5) * 10 * scale * unit;
    const sigY = cursorY + (unitRand(seed, 81) - 0.5) * 6 * scale * unit;
    if (config.signature) {
      context.font = `${sigSize}px "Dancing Script", "${fontFamily}", Caveat, cursive`;
      const signature = takeChars(renderMerge(config.signature, contact));
      if (signature) {
        const sigWidth = drawInkWord(context, signature, sigX, sigY, sigSize, 'Dancing Script', seed, 120, unit, extraTracking * 0.4);
        const across = (sigX + sigWidth - paperX) / Math.max(1, paperW);
        pen = {
          x: sigX + sigWidth,
          y: sigY + sigSize * 0.36,
          show: writing && reveal < 0.97,
          lift: budget && budget.left > 0 ? 0 : 6 * scale,
          tilt: -0.18 + across * 0.22,
        };
        context.save();
        context.globalAlpha = 0.55 + 0.25 * unit;
        context.lineWidth = Math.max(1.2, sigSize * 0.045);
        context.lineCap = 'round';
        context.beginPath();
        context.moveTo(sigX - 4 * scale, sigY + sigSize * 0.82);
        context.bezierCurveTo(
          sigX + sigWidth * 0.35,
          sigY + sigSize * 0.92,
          sigX + sigWidth * 0.7,
          sigY + sigSize * 0.72,
          sigX + sigWidth + 8 * scale,
          sigY + sigSize * 0.86,
        );
        context.stroke();
        context.restore();
      }
    }
    if (signatureImage && (!writing || reveal > 0.78)) {
      context.drawImage(signatureImage, paperX + paperW * 0.55, sigY - sigSize * 0.15, paperW * 0.28, paperH * 0.16);
    }
    cursorY = sigY + sigSize * 1.35;
    context.font = `${fontSize}px "${fontFamily}", "Homemade Apple", Caveat, cursive`;
  }

  if (postscript) {
    cursorY += fontSize * 0.2;
    paintLines(postscript, cursorY, false, 400);
  }
  if (pen.show && !writingHand) drawWritingPen(context, pen.x, pen.y, Math.max(3.4, fontSize * 0.22), seed + Math.round(reveal * 80));
  context.restore();
  return pen;
}

function drawTypedNote(
  context: CanvasRenderingContext2D,
  config: StudioConfig,
  contact: Contact,
  canvasWidth: number,
  canvasHeight: number,
  scale: number,
  animationPhase = 1,
) {
  const family = config.fontFamily || 'Space Grotesk';
  const fontSize = Math.max(14, config.fontSize * scale);
  const tracking = (config.letterSpacing ?? 0) * scale;
  const zone = config.textZone ?? { x: 0.4, y: 0.14, width: 0.46, height: 0.7 };
  const x = canvasWidth * zone.x;
  const y = canvasHeight * zone.y;
  const w = canvasWidth * zone.width;
  const h = canvasHeight * zone.height;
  const message = config.showMessage === false ? '' : resolveMessage(config, contact);
  let body = [
    renderMerge(config.copy, contact),
    message,
    config.signature ? renderMerge(config.signature, contact) : '',
    config.postscript ? renderMerge(config.postscript, contact) : '',
  ].filter(Boolean).join('\n\n');
  const motion = config.textMotion ?? 'still';
  const typing = motion === 'type';
  let caretOn = false;
  if (typing) {
    const t = Math.max(0, Math.min(1, animationPhase / 0.86));
    body = body.slice(0, Math.floor(body.length * t));
    caretOn = t < 0.98 || Math.sin(animationPhase * Math.PI * 10) > 0;
  }
  context.save();
  context.beginPath();
  context.rect(x, y, w, h);
  context.clip();
  context.fillStyle = config.inkColor || '#1c1612';
  context.textBaseline = 'top';
  context.textAlign = 'left';
  context.font = `500 ${fontSize}px "${family}", "Manrope", sans-serif`;
  if (tracking) context.letterSpacing = `${tracking}px`;
  if (motion === 'glow') {
    context.shadowColor = '#f2c14e';
    context.shadowBlur = 6 + 16 * Math.abs(Math.sin(animationPhase * Math.PI * 2));
  }
  const lines = wrapLines(context, body, w);
  const lineHeight = fontSize * (config.lineSpacing || 1.45);
  const markerColor = colorWithAlpha(config.layers[0]?.highlightColor || '#ffe566', 0.78);
  const needles = expandHighlightNeedles((config.layers[0]?.highlight) || '', contact);
  const highlightAll = motion === 'highlight' && needles.length === 0;
  const wipe = motion === 'highlight'
    ? Math.max(0, Math.min(1, (animationPhase - 0.05) / 0.82))
    : 1;
  lines.forEach((line, index) => {
    const lineY = y + index * lineHeight;
    if (line) {
      const lineWidth = context.measureText(line).width;
      if (highlightAll) {
        drawMarkerStroke(context, x, lineY, lineWidth * wipe, fontSize, markerColor);
      } else if (needles.length) {
        const wordWipe = motion === 'highlight' ? Math.min(1, Math.max(0, (wipe - 0.04) / 0.38)) : 1;
        for (const range of highlightRanges(line, needles)) {
          const left = x + context.measureText(line.slice(0, range.start)).width;
          const width = context.measureText(line.slice(range.start, range.end)).width;
          drawMarkerStroke(context, left, lineY, width * wordWipe, fontSize, markerColor);
        }
      }
    }
    context.fillStyle = config.inkColor || '#1c1612';
    context.fillText(line, x, lineY, w);
  });
  if (caretOn) {
    const last = lines[lines.length - 1] ?? '';
    const caretX = x + context.measureText(last).width + 2;
    const caretY = y + Math.max(0, lines.length - 1) * lineHeight;
    context.fillStyle = config.inkColor || '#1c1612';
    context.fillRect(caretX, caretY, Math.max(2, fontSize * 0.08), fontSize * 0.92);
  }
  context.restore();
}

let artefactTypefacesReady = false;

async function ensureArtefactTypefaces(config: StudioConfig) {
  if (typeof document === 'undefined' || !document.fonts) return;
  await loadArtefactFonts();
  const family = config.fontFamily || (config.mode === 'avatar' ? 'Space Grotesk' : 'Homemade Apple');
  const size = config.fontSize || 40;
  if (!artefactTypefacesReady) {
    await Promise.all([
      document.fonts.load(`500 ${size}px "Space Grotesk"`),
      document.fonts.load(`700 ${size}px "Space Grotesk"`),
      document.fonts.load(`500 ${size}px "Manrope"`),
      document.fonts.load(`${size}px "Homemade Apple"`),
      document.fonts.load(`${size}px Caveat`),
      document.fonts.ready,
    ]);
    artefactTypefacesReady = true;
  }
  await document.fonts.load(`${size}px "${family}"`);
}

export async function renderStudioCanvas(
  config: StudioConfig,
  contact: Contact,
  scale = 1,
  animationPhase = 1,
  options: { omitText?: boolean; omitImage?: boolean; omitAvatar?: boolean } = {},
) {
  await ensureArtefactTypefaces(config);
  const target = dimensions[config.channel] ?? dimensions.LinkedIn;
  const width = Math.round(target.width * scale);
  const height = Math.round(target.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas is unavailable in this browser.');

  if (config.mode === 'handwritten' || config.mode === 'avatar' || config.mode === 'handgif') {
    const seed = (config.seed ?? 7) + contact.row;
    const finishes: NoteFinish[] = ['desk', 'scanned', 'soft-shadow', 'clean'];
    const surfaces: DeskSurface[] = ['pine', 'walnut', 'oak', 'maple', 'mahogany'];
    const finish = config.shuffleFinish ? pickFrom(finishes, seed) : (config.finish ?? 'desk');
    const surface = config.shuffleFinish ? pickFrom(surfaces, seed + 3) : migrateDeskSurface(config.surface);
    const fontFamily = config.mode === 'avatar'
      ? (config.fontFamily || 'Space Grotesk')
      : config.shuffleHandwriting
        ? pickFrom(handwritingFonts, seed + 11)
        : (config.fontFamily || 'Homemade Apple');
    const handSpec = writingHandSpec(config);
    const writingHand = config.mode === 'handgif' ? await loadImage(publicAssetUrl(handSpec.src)) : null;
    const deskPhoto = finish === 'desk' ? await loadImage(config.deskImage) : null;
    const woodPhoto = finish === 'desk' && surface !== 'custom'
      ? await loadImage(deskTextureUrls[surface])
      : null;
    if (finish === 'desk' && deskPhoto) {
      drawImageCover(context, deskPhoto, 0, 0, width, height, defaultCrop);
      context.fillStyle = 'rgba(20,12,8,.18)';
      context.fillRect(0, 0, width, height);
    } else if (finish === 'desk') {
      paintDeskSurface(context, surface, width, height, scale, seed, config.deskColor, woodPhoto);
    } else if (finish === 'scanned') {
      context.fillStyle = '#d8d4cc';
      context.fillRect(0, 0, width, height);
      const bed = context.createLinearGradient(0, 0, 0, height);
      bed.addColorStop(0, '#f3f1ec');
      bed.addColorStop(0.5, '#e7e3da');
      bed.addColorStop(1, '#cfc9bd');
      context.fillStyle = bed;
      context.fillRect(width * 0.03, height * 0.025, width * 0.94, height * 0.95);
      context.fillStyle = 'rgba(30,24,18,.07)';
      for (let i = 0; i < 220; i++) {
        context.fillRect((i * 53 + seed) % width, (i * 37) % height, 2 * scale, 2 * scale);
      }
      context.strokeStyle = 'rgba(20,16,12,.18)';
      context.lineWidth = 10 * scale;
      context.strokeRect(4 * scale, 4 * scale, width - 8 * scale, height - 8 * scale);
    } else if (finish === 'soft-shadow') {
      context.fillStyle = '#efece6';
      context.fillRect(0, 0, width, height);
      const wash = context.createRadialGradient(width * 0.5, height * 0.4, 20, width * 0.5, height * 0.5, width * 0.7);
      wash.addColorStop(0, '#f7f5f1');
      wash.addColorStop(1, '#e4dfd6');
      context.fillStyle = wash;
      context.fillRect(0, 0, width, height);
    } else {
      context.fillStyle = '#fbfaf7';
      context.fillRect(0, 0, width, height);
    }

    const zone = config.noteZone ?? finishPaperZone(finish);
    const paperX = width * zone.x;
    const paperY = height * zone.y;
    const paperW = width * zone.width;
    const paperH = height * zone.height;
    const radius = (finish === 'clean' ? 2 : finish === 'scanned' ? 3 : 11) * scale;
    const scanNudge = finish === 'scanned' ? 1.6 + unitRand(seed, 4) * 1.8 : 0;
    const tilt = config.mode === 'avatar' || finish === 'clean'
      ? 0
      : realismAngle(seed, config.realism ?? 70) + (finish === 'scanned' ? scanNudge : 0);
    const originX = paperX + paperW / 2;
    const originY = paperY + paperH / 2;

    context.save();
    context.translate(originX, originY);
    context.rotate((tilt * Math.PI) / 180);
    context.translate(-originX, -originY);

    if (finish === 'desk' || finish === 'soft-shadow') {
      context.save();
      context.fillStyle = finish === 'desk' ? 'rgba(18, 12, 8, 0.22)' : 'rgba(18, 12, 8, 0.16)';
      context.beginPath();
      context.ellipse(originX + 6 * scale, paperY + paperH + (finish === 'desk' ? 10 : 18) * scale, paperW * (finish === 'desk' ? 0.42 : 0.46), (finish === 'desk' ? 16 : 22) * scale, 0, 0, Math.PI * 2);
      context.fill();
      context.restore();
      context.save();
      context.shadowColor = finish === 'desk' ? 'rgba(18,12,8,0.34)' : 'rgba(18,12,8,0.28)';
      context.shadowBlur = (finish === 'desk' ? 34 : 28) * scale;
      context.shadowOffsetY = (finish === 'desk' ? 12 : 16) * scale;
      context.shadowOffsetX = 3 * scale;
      context.fillStyle = paperColorFor(config);
      roundedRect(context, paperX, paperY, paperW, paperH, radius);
      context.fill();
      context.restore();
    } else if (finish === 'scanned') {
      context.save();
      context.fillStyle = 'rgba(20,16,12,.12)';
      roundedRect(context, paperX + 4 * scale, paperY + 5 * scale, paperW, paperH, radius);
      context.fill();
      context.restore();
    }

    context.save();
    roundedRect(context, paperX, paperY, paperW, paperH, radius);
    context.clip();
    paperBackground(context, config, paperX, paperY, paperW, paperH, scale, seed);
    if (finish === 'scanned') {
      context.fillStyle = 'rgba(40,34,28,.045)';
      for (let i = 0; i < 140; i++) {
        context.fillRect(paperX + unitRand(seed, i) * paperW, paperY + unitRand(seed, i + 90) * paperH, 2 * scale, 2 * scale);
      }
      context.fillStyle = 'rgba(255,255,255,.08)';
      context.fillRect(paperX, paperY, paperW, 8 * scale);
    }
    const custom = await loadImage(config.customImage);
    if (custom) drawImageCover(context, custom, paperX, paperY, paperW, paperH, config.imageCrop ?? defaultCrop);
    if (finish !== 'clean') {
      context.fillStyle = 'rgba(255,255,255,.22)';
      context.fillRect(paperX, paperY, paperW, 3 * scale);
      paintDogEar(context, paperX, paperY, paperW, scale, seed);
    }
    if (config.mode === 'avatar' && !options.omitAvatar) {
      await paintAvatarOnPaper(context, config, contact, width, height, scale);
    }
    let pen = { x: 0, y: 0, show: false, lift: 0, tilt: -0.08 };
    if (!options.omitText) {
      if (config.mode === 'avatar') {
        drawTypedNote(context, config, contact, width, height, scale, animationPhase);
      } else {
        const signature = await loadImage(config.signatureImage);
        pen = drawHandwriting(context, config, contact, paperX, paperY, paperW, paperH, fontFamily, seed, scale, animationPhase, signature, writingHand);
      }
    }
    context.restore();
    if (pen.show && writingHand) {
      drawWritingHandPhoto(
        context,
        writingHand,
        pen.x,
        pen.y,
        paperW,
        scale,
        seed + Math.round((animationPhase || 0) * 80),
        handSpec.tip,
        { tilt: pen.tilt, lift: pen.lift, phase: animationPhase },
      );
    }

    context.save();
    context.strokeStyle = finish === 'clean' ? 'rgba(40, 28, 16, 0.06)' : 'rgba(40, 28, 16, 0.12)';
    context.lineWidth = 1.2 * scale;
    roundedRect(context, paperX + 0.6 * scale, paperY + 0.6 * scale, paperW - 1.2 * scale, paperH - 1.2 * scale, radius);
    context.stroke();
    context.restore();
    context.restore();
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
    const baseGradient = context.createLinearGradient(0, 0, width, height);
    baseGradient.addColorStop(0, start);
    baseGradient.addColorStop(1, end);
    context.fillStyle = baseGradient;
    context.fillRect(0, 0, width, height);
    const custom = await loadImage(config.customImage);
    if (custom && !options.omitImage) {
      context.save();
      context.beginPath();
      context.rect(0, 0, width, height);
      context.clip();
      let imgX = 0;
      let imgY = 0;
      let imgW = width;
      let imgH = height;
      const photo = config.photoMotion ?? 'still';
      if (photo === 'rise') {
        imgH = height * 1.18;
        imgY = Math.sin(animationPhase * Math.PI * 2) * height * -0.09 - height * 0.05;
      } else if (photo === 'zoom') {
        const zoom = 1.08 + 0.1 * Math.sin(animationPhase * Math.PI * 2);
        imgW = width * zoom;
        imgH = height * zoom;
        imgX = (width - imgW) / 2;
        imgY = (height - imgH) / 2;
      } else if (photo === 'drift') {
        imgW = width * 1.1;
        imgH = height * 1.1;
        imgX = Math.sin(animationPhase * Math.PI * 2) * width * 0.03 - width * 0.04;
        imgY = Math.cos(animationPhase * Math.PI * 2) * height * 0.025 - height * 0.04;
      }
      drawImageCover(context, custom, imgX, imgY, imgW, imgH, config.imageCrop ?? defaultCrop);
      context.restore();
      const overlay = context.createLinearGradient(0, 0, 0, height);
      overlay.addColorStop(0, 'rgba(8,6,4,.42)');
      overlay.addColorStop(0.24, 'rgba(8,6,4,0)');
      overlay.addColorStop(0.74, 'rgba(8,6,4,0)');
      overlay.addColorStop(1, 'rgba(8,6,4,.46)');
      context.fillStyle = overlay;
      context.fillRect(0, 0, width, height);
      if (config.effect === 'fire') {
        const heat = 0.32 + 0.2 * Math.abs(Math.sin(animationPhase * Math.PI * 2));
        const flame = context.createLinearGradient(0, height, 0, height * 0.28);
        flame.addColorStop(0, `rgba(255,72,0,${heat})`);
        flame.addColorStop(0.45, `rgba(255,160,20,${heat * 0.45})`);
        flame.addColorStop(1, 'rgba(255,200,40,0)');
        context.fillStyle = flame;
        context.fillRect(0, 0, width, height);
      }
    } else if (!options.omitImage) {
      context.globalAlpha = 0.14;
      for (let x = -height; x < width; x += 90) context.fillRect(x, 0, 34, height);
      context.globalAlpha = 1;
    }

    const websiteUrl = config.websiteColumn ? String(contact[config.websiteColumn] ?? '') : '';
    const website = await loadImage(websiteUrl);
    if (website) {
      const zone = config.websiteZone;
      context.save();
      roundedRect(context, width * zone.x, height * zone.y, width * zone.width, height * zone.height, 24 * scale);
      context.clip();
      drawImageCover(context, website, width * zone.x, height * zone.y, width * zone.width, height * zone.height, config.imageCrop ?? defaultCrop);
      context.restore();
    }
    if (options.omitText) return canvas;
    const bounce = config.animation === 'bounce' ? Math.sin(animationPhase * Math.PI * 2) * 0.1 : 0;
    const rise = config.animation === 'rise' ? Math.sin(animationPhase * Math.PI * 2) * 0.11 : 0;
    const wobble = config.animation === 'wobble' ? Math.sin(animationPhase * Math.PI * 2) * 0.045 : 0;
    const shake = config.animation === 'shake' ? Math.sin(animationPhase * Math.PI * 8) * 0.03 : 0;
    const drift = config.animation === 'drift' ? Math.sin(animationPhase * Math.PI * 2) * 0.035 : 0;
    const scaleMotion = config.animation === 'pulse'
      ? 0.9 + 0.16 * Math.sin(animationPhase * Math.PI * 2)
      : config.animation === 'pop'
        ? animationPhase < 0.42 ? 0.55 + animationPhase * 1.45 : 1.16 - (animationPhase - 0.42) * 0.28
        : config.animation === 'zoom'
          ? 0.92 + 0.14 * Math.sin(animationPhase * Math.PI * 2)
          : 1;
    const phase = config.animation === 'flip'
      ? (animationPhase < 0.5 ? 0.16 : 1)
      : config.animation === 'fade'
        ? Math.max(0.12, animationPhase)
        : 1;
    const offset = config.animation === 'slide' ? (1 - animationPhase) * 0.18 : wobble + drift;
    const wobbleRot = config.animation === 'wobble' || config.animation === 'drift'
      ? Math.sin(animationPhase * Math.PI * 2) * 0.05
      : 0;
    for (const layer of config.layers) {
      context.save();
      const cx = (layer.x + layer.width / 2 + offset + shake) * width;
      const cy = (layer.y + layer.height / 2 - bounce - rise) * height;
      context.translate(cx, cy);
      context.rotate(wobbleRot);
      context.scale(scaleMotion, scaleMotion);
      context.translate(-cx, -cy);
      drawLayer(
        context,
        { ...layer, x: layer.x + offset + shake, y: layer.y - bounce - rise },
        contact,
        width,
        height,
        phase,
      );
      context.restore();
    }
  }
  return canvas;
}

export function canvasToBlob(canvas: HTMLCanvasElement, type = 'image/png', quality = 0.9) {
  return new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Image export failed.'))), type, quality),
  );
}

export async function renderStaticAsset(config: StudioConfig, contact: Contact, quality = 0.9) {
  const canvas = await renderStudioCanvas(config, contact);
  return canvasToBlob(canvas, 'image/png', quality);
}

export async function renderPreview(
  config: StudioConfig,
  contact: Contact,
  canvas: HTMLCanvasElement,
  animationPhase = 1,
  options: { omitText?: boolean; omitImage?: boolean; omitAvatar?: boolean; signal?: AbortSignal } = {},
) {
  const writing = config.mode === 'handgif' || (config.mode === 'avatar' && (config.textMotion ?? 'still') !== 'still');
  const source = await renderStudioCanvas(config, contact, writing ? 0.38 : 0.64, animationPhase, options);
  if (options.signal?.aborted) return;
  canvas.width = source.width;
  canvas.height = source.height;
  const context = canvas.getContext('2d');
  context?.drawImage(source, 0, 0);
}

export async function renderGifAsset(config: StudioConfig, contact: Contact, signal?: AbortSignal) {
  const avatarAnim = config.mode === 'avatar' && (config.textMotion ?? 'still') !== 'still';
  const writing = config.mode === 'handgif'
    || avatarAnim
    || (config.layers ?? []).some((layer) => (layer.animation ?? 'still') !== 'still');
  const speed = writingSpeedSpec(config.writingSpeed);
  const previewScale = writing && (config.mode === 'handgif' || config.mode === 'avatar')
    ? Math.min(0.4, 0.26 + config.gifQuality * 0.018)
    : Math.min(0.68, 0.34 + config.gifQuality * 0.035);
  const { width, height } = dimensions[config.channel] ?? dimensions.LinkedIn;
  const frameWidth = Math.round(width * previewScale);
  const frameHeight = Math.round(height * previewScale);
  const frames: ArrayBuffer[] = [];
  const sourceFrames = config.gifFrames?.length ? config.gifFrames.slice(0, 36) : undefined;
  const frameCount = sourceFrames?.length ?? (config.mode === 'handgif' ? speed.frames : avatarAnim ? 16 : writing ? 10 : 12);
  const delays: number[] = [];
  for (let index = 0; index < frameCount; index++) {
    if (signal?.aborted) throw new DOMException('Generation cancelled', 'AbortError');
    const linear = frameCount === 1 ? 1 : index / (frameCount - 1);
    const hold = writing && index >= frameCount - 2;
    const phase = hold ? 1 : linear;
    const frameConfig = sourceFrames ? { ...config, customImage: sourceFrames[index] } : config;
    const canvas = await renderStudioCanvas(frameConfig, contact, previewScale, phase);
    const data = canvas.getContext('2d')?.getImageData(0, 0, frameWidth, frameHeight);
    if (!data) throw new Error('Could not prepare GIF frame.');
    frames.push(data.data.buffer);
    const tick = config.mode === 'handgif'
      ? Math.round(speed.ms / Math.max(1, frameCount))
      : Math.round(1000 / Math.max(6, config.gifFps));
    delays.push(config.gifDelays?.[index] ?? (hold ? Math.max(400, tick * 4) : tick));
  }
  const worker = new Worker(new URL('./gif.worker.ts', import.meta.url), { type: 'module' });
  return await new Promise<Blob>((resolve, reject) => {
    const abort = () => {
      worker.terminate();
      reject(new DOMException('Generation cancelled', 'AbortError'));
    };
    signal?.addEventListener('abort', abort, { once: true });
    worker.onmessage = (event) => {
      signal?.removeEventListener('abort', abort);
      worker.terminate();
      if (!event.data.ok) reject(new Error(event.data.error));
      else resolve(new Blob([event.data.bytes], { type: 'image/gif' }));
    };
    worker.onerror = () => {
      signal?.removeEventListener('abort', abort);
      worker.terminate();
      reject(new Error('GIF worker failed.'));
    };
    worker.postMessage({
      width: frameWidth,
      height: frameHeight,
      delays,
      loop: config.gifLoop,
      colors: config.gifQuality >= 8 ? 256 : config.gifQuality >= 5 ? 128 : 64,
      frames,
    }, frames);
  });
}

export function modeLabel(mode: StudioMode) {
  if (mode === 'handwritten') return 'Handwritten note';
  if (mode === 'handgif') return 'Handwriting GIF';
  if (mode === 'memes') return 'Meme';
  if (mode === 'avatar') return 'Avatar card';
  return 'Animated GIF';
}

export function usesMotion(config: StudioConfig) {
  return config.mode !== 'handwritten' && config.mode !== 'avatar' && config.mode !== 'handgif' && config.animation && config.animation !== 'still';
}

export function isLiveGif(config: StudioConfig) {
  return Boolean(config.gifSourceDataUrl);
}

export function usesPhotoMotion(config: StudioConfig) {
  return Boolean(config.photoMotion && config.photoMotion !== 'still');
}

export function usesTextAnim(config: StudioConfig) {
  if (config.mode === 'handgif') return true;
  if (config.mode === 'avatar') return (config.textMotion ?? 'still') !== 'still';
  return (config.layers ?? []).some((layer) => (layer.animation ?? 'still') !== 'still');
}

export function usesLivePreview(config: StudioConfig) {
  return usesMotion(config) || isLiveGif(config) || usesPhotoMotion(config) || config.effect === 'fire' || usesTextAnim(config);
}
