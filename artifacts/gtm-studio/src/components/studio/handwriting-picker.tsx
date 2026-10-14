import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { ChevronDown } from 'lucide-react';
import { FieldRow } from '@/components/studio/shared';
import { Checkbox } from '@/components/ui/checkbox';
import { loadHandwritingFonts } from '@/studio/fonts';
import { handwritingGroups, handwritingStyles, legacyHandwritingFonts, type HandwritingStyle, type PhoneReadability } from '@/studio/handwriting-fonts';
import { phoneTagLabel } from '@/studio/handwriting-readability';
import { renderMerge } from '@/studio/merge';
import type { Contact, StudioConfig } from '@/studio/types';

const SAMPLE_COPY = 'Hi {first_name|there}, quick note about {company|your team}.';
const tagText: Record<PhoneReadability, string> = { good: 'Good', ok: 'OK', small: 'Small' };

/** The sample line in the selected row's own words, so the picker shows how that note will look. */
function sampleFor(contact: Contact) {
  return renderMerge(SAMPLE_COPY, contact).replace(/\s+/g, ' ').trim();
}

/**
 * Writing style picker for Notes and Handwriting GIF: fonts in groups (each says when to use it), the real
 * font name, a sample in the selected row's words, and how readable the writing is on a phone.
 * The sample fonts load only once the picker is on screen, and only for the groups that are open.
 */
export function HandwritingPicker({
  config,
  setConfig,
  contact,
}: {
  config: StudioConfig;
  setConfig: (update: (current: StudioConfig) => StudioConfig) => void;
  contact: Contact;
}) {
  const selected = config.customFontDataUrl ? undefined : handwritingStyles.find((style) => style.font === config.fontFamily);
  const [open, setOpen] = useState<Set<string>>(() => new Set([selected?.group ?? 'casual']));
  const [phoneOnly, setPhoneOnly] = useState(false);
  const [onScreen, setOnScreen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const sample = sampleFor(contact);

  useEffect(() => {
    const node = root.current;
    if (!node) return;
    if (typeof IntersectionObserver === 'undefined') {
      setOnScreen(true);
      return;
    }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) setOnScreen(true);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const groups = useMemo(() => handwritingGroups.map((group) => ({
    group,
    styles: handwritingStyles.filter((style) => style.group === group.id && (!phoneOnly || style.phone === 'good' || style === selected)),
  })).filter((item) => item.styles.length > 0), [phoneOnly, selected]);

  const fontsToLoad = useMemo(
    () => groups.filter((item) => open.has(item.group.id)).flatMap((item) => item.styles.map((style) => style.font)),
    [groups, open],
  );
  useEffect(() => {
    if (onScreen && fontsToLoad.length) void loadHandwritingFonts(fontsToLoad);
  }, [onScreen, fontsToLoad]);

  const toggle = (id: string) => setOpen((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });

  // One tab stop for the whole picker: the chosen font, else the first one showing. Arrow keys move between options.
  const visible = groups.filter((item) => open.has(item.group.id)).flatMap((item) => item.styles);
  const tabStop = visible.find((style) => style === selected) ?? visible[0];
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const keys = ['ArrowDown', 'ArrowUp', 'ArrowRight', 'ArrowLeft', 'Home', 'End'];
    if (!keys.includes(event.key)) return;
    const options = Array.from(root.current?.querySelectorAll<HTMLElement>('[role="option"]') ?? []);
    const index = options.indexOf(document.activeElement as HTMLElement);
    if (index < 0) return;
    event.preventDefault();
    const next = event.key === 'Home' ? 0
      : event.key === 'End' ? options.length - 1
        : event.key === 'ArrowDown' || event.key === 'ArrowRight' ? Math.min(options.length - 1, index + 1)
          : Math.max(0, index - 1);
    options[next]?.focus();
  };

  const pick = (style: HandwritingStyle) => setConfig((current) => ({ ...current, fontFamily: style.font, customFontDataUrl: undefined }));

  return (
    <FieldRow id="handwriting-style" label="Writing style" hint="Pick the hand the note is written in. Each group says when to use it.">
      <div ref={root} id="handwriting-style" className="hw-picker" onKeyDown={onKeyDown}>
        <button
          type="button"
          className={`hw-filter ${phoneOnly ? 'is-on' : ''}`}
          aria-pressed={phoneOnly}
          onClick={() => setPhoneOnly((value) => !value)}
        >
          Good on phones
        </button>
        {groups.map(({ group, styles }) => {
          const expanded = open.has(group.id);
          return (
            <section key={group.id} className="hw-group">
              <button type="button" className="hw-group-head" aria-expanded={expanded} aria-controls={`hw-${group.id}`} onClick={() => toggle(group.id)}>
                <span className="hw-group-title">{group.label} <span className="hw-group-count">{styles.length}</span></span>
                <ChevronDown size={16} aria-hidden className={expanded ? 'rotate-180' : ''} />
              </button>
              <p className="hw-group-use">{group.useWhen}</p>
              <div id={`hw-${group.id}`} className="hw-options" role="listbox" aria-label={group.label} hidden={!expanded}>
                {expanded && styles.map((style) => {
                  const active = style === selected;
                  return (
                    <button
                      type="button"
                      key={style.id}
                      role="option"
                      aria-selected={active}
                      tabIndex={style === tabStop ? 0 : -1}
                      className={`writing-style ${active ? 'is-active' : ''}`}
                      onClick={() => pick(style)}
                    >
                      <span className="writing-style-sample" style={{ fontFamily: `"${style.font}", cursive`, fontSize: Math.round(19 * style.scale * 10) / 10 }}>{sample}</span>
                      <span className="writing-style-meta">
                        <span className="writing-style-name">{style.label}</span>
                        <span className={`hw-tag hw-tag-${style.phone}`} title={phoneTagLabel[style.phone]}>{tagText[style.phone]}<span className="sr-only"> on phones</span></span>
                      </span>
                      <span className="writing-style-note">{style.note}</span>
                    </button>
                  );
                })}
              </div>
            </section>
          );
        })}
        {phoneOnly && <p className="helper">Showing fonts rated Good on phones, plus your current pick.</p>}
      </div>
    </FieldRow>
  );
}

/** "Mix fonts across rows": off by default, with the reason to leave it off. */
export function MixFontsToggle({ checked, onChange }: { checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <div className="col-span-2">
      <label className="toggle-row"><Checkbox className="h-5 w-5 rounded-[4px] border-input" checked={checked} onCheckedChange={(value) => onChange(value === true)} /> Mix fonts across rows</label>
      <p className="helper mt-2">Real people write in one hand, so mixing fonts can make notes look mass-produced. When on, each row is written in one of {legacyHandwritingFonts.join(', ').replace(/, ([^,]+)$/, ' and $1')}.</p>
    </div>
  );
}
