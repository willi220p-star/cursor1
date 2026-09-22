const KEY = 'gtm-note-font-files';

export type StoredNoteFont = { dataUrl: string };

export function readNoteFonts(): Record<string, StoredNoteFont> {
  if (typeof localStorage === 'undefined') return {};
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, StoredNoteFont>;
    if (!parsed || typeof parsed !== 'object') return {};
    return Object.fromEntries(
      Object.entries(parsed).filter((entry) => typeof entry[1]?.dataUrl === 'string' && entry[1].dataUrl.startsWith('data:')),
    );
  } catch {
    return {};
  }
}

export async function installNoteFonts(fonts: Record<string, StoredNoteFont>) {
  if (typeof document === 'undefined' || !document.fonts) return;
  await Promise.all(Object.entries(fonts).map(async ([family, face]) => {
    try {
      const loaded = new FontFace(family, `url(${face.dataUrl})`);
      await loaded.load();
      document.fonts.add(loaded);
    } catch {
      // A damaged file stays listed so the operator can replace it.
    }
  }));
}

function fileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error('Could not read that font file.'));
    reader.readAsDataURL(file);
  });
}

/** Register a licensed font file under the writing-style name and keep it on this browser. */
export async function saveNoteFont(family: string, file: File) {
  const buffer = await file.arrayBuffer();
  const loaded = new FontFace(family, buffer);
  await loaded.load();
  document.fonts.add(loaded);
  const dataUrl = await fileAsDataUrl(file);
  const next = { ...readNoteFonts(), [family]: { dataUrl } };
  localStorage.setItem(KEY, JSON.stringify(next));
  return dataUrl;
}
