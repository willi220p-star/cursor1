export type StudioMode = 'handwritten' | 'memes' | 'gif' | 'avatar' | 'handgif';

export const studioModes: { id: StudioMode; label: string; hint: string }[] = [
  { id: 'handwritten', label: 'Handwritten notes', hint: 'Paper desk' },
  { id: 'avatar', label: 'Avatar cards', hint: 'Portrait desk' },
  { id: 'memes', label: 'Moving memes', hint: 'Cutting room' },
  { id: 'gif', label: 'Animated GIFs', hint: 'Cutting room' },
  { id: 'handgif', label: 'Handwriting GIF', hint: 'Writing hand' },
];

export function isPaperDesk(mode: StudioMode) {
  return mode === 'handwritten' || mode === 'avatar' || mode === 'handgif';
}

export function isCutRoom(mode: StudioMode) {
  return mode === 'memes' || mode === 'gif';
}

export function isHandwritingDesk(mode: StudioMode) {
  return mode === 'handwritten' || mode === 'handgif';
}

export function modeHref(mode: StudioMode) {
  return `/${mode}`;
}

export function studioLabel(mode: StudioMode) {
  return studioModes.find((item) => item.id === mode)?.label ?? mode;
}

export const canvasSizes = {
  A4: { width: 1240, height: 1754, label: 'A4 · 1240 × 1754' },
  LinkedIn: { width: 1080, height: 1080, label: 'LinkedIn · 1080 × 1080' },
  Email: { width: 1200, height: 628, label: 'Email / LinkedIn banner · 1200 × 628' },
  Portrait: { width: 1080, height: 1350, label: 'Portrait · 1080 × 1350' },
  Widescreen: { width: 1600, height: 900, label: 'Widescreen · 1600 × 900' },
  Classic: { width: 800, height: 600, label: 'Classic · 800 × 600' },
} as const;

export type CanvasSize = keyof typeof canvasSizes;

export type CanvasZone = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type CropFocus = {
  zoom: number;
  x: number;
  y: number;
};

export type AvatarShape = 'circle' | 'rounded' | 'square';

export const defaultCrop: CropFocus = { zoom: 1, x: 0.5, y: 0.5 };

export const typedFonts = ['Space Grotesk', 'Manrope'] as const;

export function coverCropRect(
  srcW: number,
  srcH: number,
  destW: number,
  destH: number,
  crop: CropFocus = defaultCrop,
) {
  const nw = Math.max(1, srcW || 1);
  const nh = Math.max(1, srcH || 1);
  const zoom = Math.max(1, Math.min(4, Number.isFinite(crop.zoom) ? crop.zoom : 1));
  const scale = Math.max(destW / nw, destH / nh) * zoom;
  const sw = Math.min(nw, destW / scale);
  const sh = Math.min(nh, destH / scale);
  const maxX = Math.max(0, nw - sw);
  const maxY = Math.max(0, nh - sh);
  const fx = Math.max(0, Math.min(1, crop.x ?? 0.5));
  const fy = Math.max(0, Math.min(1, crop.y ?? 0.5));
  return { sx: maxX * fx, sy: maxY * fy, sw, sh };
}

export function cropLayerStyle(crop: CropFocus = defaultCrop): Record<string, string> {
  const x = `${Math.round((crop.x ?? 0.5) * 1000) / 10}%`;
  const y = `${Math.round((crop.y ?? 0.5) * 1000) / 10}%`;
  const zoom = String(Math.max(1, Math.min(4, crop.zoom || 1)));
  return {
    '--crop-x': x,
    '--crop-y': y,
    '--crop-zoom': zoom,
    objectPosition: `${x} ${y}`,
  };
}

export const AVATAR_CACHE_FIELD = '_avatar_cache';
export const AVATAR_SOURCE_FIELD = '_avatar_source';
export const internalContactKeys = ['row', AVATAR_CACHE_FIELD, AVATAR_SOURCE_FIELD];

export const avatarColumnAliases = [
  'avatar',
  'avatar_url',
  'avatar_link',
  'photo',
  'photo_url',
  'photo_link',
  'image_link',
  'image_url',
  'image',
  'img',
  'img_url',
  'img_link',
  'picture',
  'picture_url',
  'headshot',
  'headshot_url',
  'profile_pic',
  'profile_picture',
  'profile_image',
  'profile_photo',
  'portrait',
  'portrait_url',
  'thumbnail',
  'after_image',
  'after_image_link',
  'pfp',
];
export const messageColumnAliases = ['msg', 'message', 'note', 'personal_message', 'body', 'copy'];

export function looksLikeImageSource(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (trimmed.startsWith('data:image') || trimmed.startsWith('blob:')) return true;
  if (/^https?:\/\//i.test(trimmed)) return true;
  if (trimmed.startsWith('/') && /\.(png|jpe?g|webp|gif|svg)(\?|$)/i.test(trimmed)) return true;
  return /\.(png|jpe?g|webp|gif|svg)(\?|#|$)/i.test(trimmed);
}

export function guessColumn(columns: string[], aliases: string[]) {
  const usable = columns.filter((column) => !internalContactKeys.includes(column.toLowerCase()));
  const lower = usable.map((column) => column.toLowerCase());
  for (const alias of aliases) {
    const index = lower.indexOf(alias);
    if (index >= 0) return usable[index];
  }
  for (const alias of aliases) {
    const index = lower.findIndex((column) => column.includes(alias) || alias.includes(column));
    if (index >= 0) return usable[index];
  }
  return '';
}

export function guessAvatarColumn(columns: string[], rows: Array<Record<string, string | number>> = []) {
  const usable = columns.filter((column) => !internalContactKeys.includes(column.toLowerCase()));
  if (!usable.length) return '';
  const ranked = usable.map((column) => {
    const name = column.toLowerCase();
    let score = 0;
    const exact = avatarColumnAliases.indexOf(name);
    if (exact >= 0) score += 240 - exact;
    else {
      const fuzzy = avatarColumnAliases.findIndex((alias) => name.includes(alias));
      if (fuzzy >= 0) score += 90 - fuzzy;
    }
    if (/(image|photo|avatar|img|headshot|picture|pfp|thumb|portrait)/.test(name)) score += 24;
    if (/(link|url|src|href)/.test(name)) score += 12;
    if (/^(website|linkedin|url|link)$/.test(name)) score -= 60;
    const sample = rows.slice(0, 16).map((row) => String(row[column] ?? ''));
    const hits = sample.filter(looksLikeImageSource).length;
    if (hits) score += 55 + hits * 6;
    return { column, score };
  }).filter((item) => item.score > 0);
  ranked.sort((a, b) => b.score - a.score);
  return ranked[0]?.column ?? guessColumn(columns, avatarColumnAliases);
}

export function avatarInNoteLayout(
  channel: CanvasSize,
  avatarWidth = 0.24,
  note: CanvasZone = { x: 0.07, y: 0.07, width: 0.86, height: 0.86 },
): { note: CanvasZone; avatar: CanvasZone; text: CanvasZone } {
  const { width, height } = canvasSizes[channel];
  const padX = note.width * 0.05;
  const padY = note.height * 0.06;
  const aw = Math.min(note.width * 0.4, Math.max(0.14, avatarWidth));
  const ah = Math.min(aw * (width / height), note.height - padY * 2);
  const avatar: CanvasZone = {
    x: note.x + padX,
    y: note.y + padY,
    width: aw,
    height: ah,
  };
  const gap = 0.028;
  const textX = avatar.x + avatar.width + gap;
  const text: CanvasZone = {
    x: textX,
    y: note.y + padY,
    width: Math.max(0.2, note.x + note.width - padX - textX),
    height: Math.max(0.2, note.height - padY * 2),
  };
  return { note, avatar, text };
}

export function clampZoneInside(inner: CanvasZone, outer: CanvasZone): CanvasZone {
  const width = Math.max(0.08, Math.min(inner.width, outer.width));
  const height = Math.max(0.06, Math.min(inner.height, outer.height));
  return {
    x: Math.max(outer.x, Math.min(outer.x + outer.width - width, inner.x)),
    y: Math.max(outer.y, Math.min(outer.y + outer.height - height, inner.y)),
    width,
    height,
  };
}

export function shiftZone(zone: CanvasZone, dx: number, dy: number): CanvasZone {
  return { ...zone, x: zone.x + dx, y: zone.y + dy };
}

export function zonesOverlap(a: CanvasZone, b: CanvasZone) {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

export type Contact = {
  row: number;
  [key: string]: string | number;
};

export type TextAnim = 'still' | 'type' | 'glow' | 'highlight' | 'pop';
export type TextMotion = 'still' | 'type' | 'glow' | 'highlight';

export const textAnims: { id: TextAnim; label: string; hint: string }[] = [
  { id: 'still', label: 'Still', hint: 'No text motion' },
  { id: 'type', label: 'Typing', hint: 'Letters appear one by one' },
  { id: 'glow', label: 'Glow', hint: 'Soft pulse around the words' },
  { id: 'highlight', label: 'Highlight', hint: 'A marker wipes under the line' },
  { id: 'pop', label: 'Pop', hint: 'Snaps in and settles' },
];

export const textMotions: { id: TextMotion; label: string; hint: string }[] = [
  { id: 'still', label: 'None', hint: 'Still letter. Download is a PNG.' },
  { id: 'type', label: 'Auto writing', hint: 'Portrait stays. The letter types in. Download is a GIF.' },
  { id: 'glow', label: 'Glow', hint: 'The letter pulses. Portrait stays.' },
  { id: 'highlight', label: 'Highlight', hint: 'A marker wipes onto the words you list. Leave the list empty to mark every line.' },
];

export type TextLayer = {
  id: string;
  name: string;
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize: number;
  align: 'left' | 'center' | 'right';
  color: string;
  outline: boolean;
  highlight?: string;
  highlightColor?: string;
  animation?: TextAnim;
  boxFill?: string;
};

export type NoteFinish = 'desk' | 'scanned' | 'soft-shadow' | 'clean';
export type DeskSurface = 'pine' | 'walnut' | 'oak' | 'maple' | 'mahogany' | 'custom';
export type PaperKind = 'notebook' | 'white-paper' | 'diary';
export type PaperColorPreset = 'white' | 'cream' | 'watercolour' | 'custom';
export type MemeMotion = 'still' | 'fade' | 'slide' | 'flip' | 'bounce' | 'pulse' | 'wobble' | 'pop' | 'shake' | 'rise' | 'zoom' | 'drift';
export type PhotoMotion = 'still' | 'rise' | 'zoom' | 'drift';
export type MemeEffect = 'none' | 'fire';
export type HandwritingKind = 'neat' | 'errors' | 'uneven' | 'messy';
export type WritingHandId = 'liner' | 'sweater' | 'fountain' | 'tripod';
export type WritingSpeed = 'slow' | 'medium' | 'fast';

export const writingSpeeds: { id: WritingSpeed; label: string; hint: string; ms: number; frames: number }[] = [
  { id: 'slow', label: 'Slow', hint: 'Careful, like signing a card', ms: 7600, frames: 16 },
  { id: 'medium', label: 'Medium', hint: 'Natural writing pace', ms: 4400, frames: 12 },
  { id: 'fast', label: 'Fast', hint: 'A quick note', ms: 2400, frames: 8 },
];

export function migrateWritingSpeed(value: string | undefined): WritingSpeed {
  if (value === 'slow' || value === 'medium' || value === 'fast') return value;
  return 'medium';
}

export function writingSpeedSpec(value: WritingSpeed | string | undefined) {
  const id = migrateWritingSpeed(value);
  return writingSpeeds.find((item) => item.id === id) ?? writingSpeeds[1];
}

export const writingHands: { id: WritingHandId; label: string; hint: string; src: string; tip: { x: number; y: number } }[] = [
  { id: 'liner', label: 'Fineliner', hint: 'Thin black marker', src: '/hands/liner.png', tip: { x: 0.055, y: 0.30 } },
  { id: 'sweater', label: 'White click', hint: 'Olive sleeve, white ballpoint', src: '/hands/sweater.png', tip: { x: 0.58, y: 0.965 } },
  { id: 'fountain', label: 'Fountain', hint: 'Navy cuff, fountain nib', src: '/hands/fountain.png', tip: { x: 0.045, y: 0.42 } },
  { id: 'tripod', label: 'Tripod grip', hint: 'Black ballpoint, three fingers', src: '/hands/tripod.png', tip: { x: 0.038, y: 0.93 } },
];

export function migrateWritingHand(value: string | undefined): WritingHandId {
  if (value === 'liner' || value === 'sweater' || value === 'fountain' || value === 'tripod') return value;
  return 'liner';
}

export const memeMotions: { id: MemeMotion; label: string; hint: string }[] = [
  { id: 'still', label: 'Still', hint: 'No motion' },
  { id: 'bounce', label: 'Bounce', hint: 'Hops up and down' },
  { id: 'pulse', label: 'Pulse', hint: 'Grows and shrinks' },
  { id: 'wobble', label: 'Wobble', hint: 'Tilts left and right' },
  { id: 'shake', label: 'Shake', hint: 'Jolts sideways' },
  { id: 'pop', label: 'Pop', hint: 'Snaps in and overshoots' },
  { id: 'fade', label: 'Fade', hint: 'Fades in and out' },
  { id: 'slide', label: 'Slide', hint: 'Sweeps across' },
  { id: 'flip', label: 'Flip', hint: 'Turns over' },
  { id: 'rise', label: 'Rise', hint: 'Lifts like heat behind the shot' },
  { id: 'zoom', label: 'Zoom', hint: 'Pushes in and out' },
  { id: 'drift', label: 'Drift', hint: 'Floats off-level' },
];

export const handwritingKinds: { id: HandwritingKind; label: string; hint: string }[] = [
  { id: 'neat', label: 'Neat handwritten', hint: 'Even lines, no mistakes. Written carefully on the ruling.' },
  { id: 'errors', label: 'Simple errors', hint: 'Crossed-out words and small slips, then the right word.' },
  { id: 'uneven', label: 'Uneven lines', hint: 'Sentences are not on the same level — they drift like real paper.' },
  { id: 'messy', label: 'Messy notebook', hint: 'Uneven lines plus mistakes and ink flecks.' },
];

export const deskSurfaces: { id: DeskSurface; label: string; swatch: string }[] = [
  { id: 'pine', label: 'Pine', swatch: '#c08a4a' },
  { id: 'oak', label: 'Oak', swatch: '#d7b07a' },
  { id: 'walnut', label: 'Walnut', swatch: '#5c3418' },
  { id: 'maple', label: 'Maple', swatch: '#e4c48a' },
  { id: 'mahogany', label: 'Mahogany', swatch: '#6b2a18' },
  { id: 'custom', label: 'Custom colour', swatch: '#6b7280' },
];

export const paperTextures: { id: string; label: string; src: string; hint: string }[] = [
  { id: 'linen', label: 'Linen', src: '/paper/linen.png', hint: 'Woven cream stationery' },
  { id: 'kraft', label: 'Kraft', src: '/paper/kraft.png', hint: 'Warm brown wrapping paper' },
  { id: 'grid', label: 'Grid', src: '/paper/grid.png', hint: 'Faint square ruling' },
];

export const paperKinds: { id: PaperKind; label: string; hint: string }[] = [
  { id: 'notebook', label: 'Notebook', hint: 'Ruled lines and a red margin, like a school pad.' },
  { id: 'white-paper', label: 'White paper', hint: 'Plain A4 sheet. No lines unless you turn them on.' },
  { id: 'diary', label: 'Diary', hint: 'Bound page with a date line and a gutter on the left.' },
];

export const paperColorPresets: { id: PaperColorPreset; label: string; hex: string }[] = [
  { id: 'white', label: 'White', hex: '#ffffff' },
  { id: 'cream', label: 'Cream white', hex: '#f7f0e1' },
  { id: 'watercolour', label: 'Sticky watercolour', hex: '#f3ebe3' },
  { id: 'custom', label: 'Custom colour', hex: '#f5eddc' },
];

export const noteFinishes: { id: NoteFinish; label: string; hint: string }[] = [
  { id: 'desk', label: 'Photo on a desk', hint: 'The sheet sits on wood with a drop shadow around it.' },
  { id: 'soft-shadow', label: 'Flat lay', hint: 'Soft shadow on a light table — no wood grain.' },
  { id: 'scanned', label: 'Scanned', hint: 'Scanner bed, photocopy grain, slightly crooked.' },
  { id: 'clean', label: 'Clean paper', hint: 'Flat export, almost edge to edge, no scene around it.' },
];

export function finishPaperZone(finish: NoteFinish): CanvasZone {
  if (finish === 'clean') return { x: 0.02, y: 0.018, width: 0.96, height: 0.964 };
  if (finish === 'scanned') return { x: 0.07, y: 0.055, width: 0.86, height: 0.89 };
  if (finish === 'soft-shadow') return { x: 0.09, y: 0.07, width: 0.82, height: 0.86 };
  return { x: 0.11, y: 0.08, width: 0.78, height: 0.84 };
}

export function migrateDeskSurface(value: string | undefined): DeskSurface {
  if (value === 'walnut' || value === 'oak' || value === 'maple' || value === 'mahogany' || value === 'custom' || value === 'pine') return value;
  return 'pine';
}

/** Notes writing styles. Each face is an open pen matched to the sample notes. */
export const noteWritingStyles = [
  { id: 'handwriting-1', label: 'Handwriting 1', font: 'Caveat', sample: 'Hi {name|there},', size: 24 },
  { id: 'handwriting-2', label: 'Handwriting 2', font: 'Nanum Pen Script', sample: 'Hi {name|there},', size: 26 },
  { id: 'handwriting-3', label: 'Handwriting 3', font: 'Handlee', sample: 'Hi {name|there},', size: 22 },
  { id: 'handwriting-4', label: 'Handwriting 4', font: 'Cedarville Cursive', sample: 'Hi {name|there},', size: 24 },
  { id: 'handwriting-5', label: 'Handwriting 5', font: 'Patrick Hand', sample: 'Hi {name|there},', size: 22 },
  { id: 'handwriting-6', label: 'Handwriting 6', font: 'Shadows Into Light', sample: 'Hi {name|there},', size: 22 },
  { id: 'handwriting-7', label: 'Handwriting 7', font: 'Gloria Hallelujah', sample: 'Hi {name|there},', size: 18 },
] as const;

export type NoteWritingStyle = (typeof noteWritingStyles)[number];

export const handwritingFonts = noteWritingStyles.map((style) => style.font);

const retiredHandwritingFonts = [
  'Homemade Apple',
  'Covered By Your Grace',
  'Reenie Beanie',
  'Sacramento',
  'Dancing Script',
  'Kalam',
  'Gochi Hand',
  'Indie Flower',
] as const;

export function isHandwritingFamily(font: string) {
  return (handwritingFonts as readonly string[]).includes(font) || (retiredHandwritingFonts as readonly string[]).includes(font);
}

export type StudioConfig = {
  id?: string;
  templateId?: string;
  mode: StudioMode;
  campaignName: string;
  template: string;
  copy: string;
  filename: string;
  channel: CanvasSize;
  fontSize: number;
  inkColor: string;
  paperColor: string;
  paperColorPreset: PaperColorPreset;
  paperKind: PaperKind;
  fontFamily: string;
  customFontDataUrl?: string;
  signature: string;
  postscript: string;
  lineSpacing: number;
  letterSpacing: number;
  noteX: number;
  noteY: number;
  realism: number;
  seed: number;
  finish: NoteFinish;
  surface: DeskSurface;
  deskColor: string;
  deskImage?: string;
  ruledLines: boolean;
  showMargin: boolean;
  shuffleHandwriting: boolean;
  shuffleFinish: boolean;
  handwritingKind: HandwritingKind;
  writingHand: WritingHandId;
  writingSpeed: WritingSpeed;
  signatureImage?: string;
  customImage?: string;
  gifFrames?: string[];
  gifDelays?: number[];
  gifSourceDataUrl?: string;
  photoMotion: PhotoMotion;
  effect: MemeEffect;
  gifFps: number;
  gifLoop: number;
  gifQuality: number;
  websiteColumn?: string;
  avatarColumn?: string;
  messageColumn?: string;
  avatarImage?: string;
  avatarUrl?: string;
  avatarShape: AvatarShape;
  message: string;
  showMessage: boolean;
  imageCrop: CropFocus;
  avatarCrop: CropFocus;
  noteZone: CanvasZone;
  textZone: CanvasZone;
  websiteZone: CanvasZone;
  avatarZone: CanvasZone;
  animation: MemeMotion;
  layers: TextLayer[];
  textMotion: TextMotion;
  fieldMap?: Array<{ column: string; use: string; customTag?: string; detected?: boolean }>;
  listSource?: string;
  sourceColumns?: string[];
  sourceFileUrl?: string;
};

export type SavedTemplate = {
  id: string;
  name: string;
  mode: StudioMode;
  config: StudioConfig;
  updatedAt: string;
  cloud: boolean;
  folderId?: string | null;
};

export type GeneratedAsset = {
  id: string;
  row: number;
  filename: string;
  blob: Blob;
  url: string;
  bytes: number;
  selected: boolean;
  status: 'ready' | 'warning' | 'failed' | 'uploaded';
  publicUrl?: string;
  error?: string;
  uploadStatus?: 'uploading' | 'uploaded' | 'failed';
  uploadError?: string;
  mode?: StudioMode;
  createdAt?: string;
};

export type SavedCampaign = {
  id: string;
  name: string;
  mode: StudioMode;
  config: StudioConfig;
  columns: string[];
  contacts: Contact[];
  updatedAt: string;
  cloud: boolean;
  syncError?: string;
  folderId?: string | null;
};
