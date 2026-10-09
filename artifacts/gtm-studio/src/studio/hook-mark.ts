/**
 * The personal hook in a note is wrapped in two private-use characters by the merge step, so the
 * canvas renderer knows which written words to underline or circle. Only the renderer asks for
 * them; everything a person sees (previews, file names, word counts, fit) merges without them.
 */
export const HOOK_OPEN = '';
export const HOOK_CLOSE = '';

const SENTINELS = /[]/g;

export function stripHookMarks(text: string) {
  return text.replace(SENTINELS, '');
}

export function wrapHook(value: string) {
  return `${HOOK_OPEN}${stripHookMarks(value)}${HOOK_CLOSE}`;
}

/** One written word, and which of its characters (if any) belong to a hook. */
export type HookWord = {
  text: string;
  /** Which hook it belongs to (0 for the first {hook} in the text), or -1. */
  span: number;
  /** Character range of the word that is hook, end exclusive. Equal when not in a hook. */
  from: number;
  to: number;
};

const EDGE_PUNCTUATION = /[\s.,;:!?…'"‘’“”()[\]-]/;

/**
 * Splits marked text the way the renderer wraps it (paragraphs, then whitespace) and returns the
 * text without sentinels plus every non-empty word in order. Punctuation at the ends of a hook is
 * left out of the marked range, so "launch." is underlined under "launch" only.
 */
export function hookWords(marked: string): { text: string; words: HookWord[] } {
  const words: HookWord[] = [];
  let span = -1;
  let spans = 0;
  let inHook = false;
  let current = '';
  let flags: number[] = [];
  const flush = () => {
    if (current) {
      const hooked = flags.map((value, index) => (value >= 0 ? index : -1)).filter((index) => index >= 0);
      let from = hooked.length ? hooked[0] : 0;
      let to = hooked.length ? hooked[hooked.length - 1] + 1 : 0;
      const chars = Array.from(current);
      while (from < to && EDGE_PUNCTUATION.test(chars[from] ?? '')) from += 1;
      while (to > from && EDGE_PUNCTUATION.test(chars[to - 1] ?? '')) to -= 1;
      const owner = hooked.length && to > from ? flags[hooked[0]] : -1;
      words.push({ text: current, span: owner, from: owner >= 0 ? from : 0, to: owner >= 0 ? to : 0 });
    }
    current = '';
    flags = [];
  };
  for (const ch of marked) {
    if (ch === HOOK_OPEN) {
      inHook = true;
      span = spans++;
      continue;
    }
    if (ch === HOOK_CLOSE) {
      inHook = false;
      continue;
    }
    if (/\s/.test(ch)) {
      flush();
      continue;
    }
    current += ch;
    flags.push(inHook ? span : -1);
  }
  flush();
  return { text: stripHookMarks(marked), words };
}

export function hasHook(text: string) {
  return text.includes(HOOK_OPEN);
}
