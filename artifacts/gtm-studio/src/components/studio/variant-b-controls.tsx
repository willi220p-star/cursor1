import { useRef } from 'react';
import { Checkbox } from '@/components/ui/checkbox';
import { FieldRow } from '@/components/studio/shared';
import { countWords } from '@/studio/note-advice';
import { renderMerge, type MergeOptions } from '@/studio/merge';
import { rowVariant } from '@/studio/variants';
import { outputColumnsFor } from '@/studio/writeback';
import type { Contact, StudioConfig } from '@/studio/types';

type VariantB = NonNullable<StudioConfig['copyVariantB']>;

/**
 * Second message for an A/B split. Odd rows keep variant A, even rows get B (variants.ts).
 * Switching off keeps the B draft for this visit, so switching back on restores it.
 */
export function VariantBControls({
  config,
  contact,
  mergeOptions,
  onChange,
}: {
  config: StudioConfig;
  contact: Contact;
  mergeOptions: MergeOptions;
  onChange: (next: VariantB | undefined) => void;
}) {
  const variant = config.copyVariantB;
  const draft = useRef<VariantB | undefined>(variant);
  if (variant) draft.current = variant;
  const cols = outputColumnsFor(config.mode);
  const current = rowVariant(config, contact);

  const toggle = (on: boolean) => {
    if (!on) {
      onChange(undefined);
      return;
    }
    onChange(draft.current ?? { copy: config.copy, postscript: undefined, openerId: config.openerId });
  };

  return (
    <div className="variant-b">
      <label className="toggle-row">
        <Checkbox className="h-5 w-5 rounded-[4px] border-input" checked={Boolean(variant)} onCheckedChange={(value) => toggle(value === true)} aria-describedby="variant-b-help" />
        Variant B (A/B test the message)
      </label>
      <p id="variant-b-help" className="helper">
        Odd rows get A, even rows get B. Generate writes {`{${cols.variant}}`} and {`{${cols.opener}}`} so Smartlead can split reply rates by variant.
      </p>
      {variant && (
        <>
          <FieldRow
            id="note-copy-b"
            label={<span className="flex items-center justify-between gap-2">Variant B message <span className="mono text-xs font-normal text-muted-foreground">{countWords(renderMerge(variant.copy, contact, mergeOptions))} words</span></span>}
          >
            <textarea
              id="note-copy-b"
              className="field leading-relaxed"
              rows={6}
              value={variant.copy}
              onChange={(event) => onChange({ ...variant, copy: event.target.value })}
            />
          </FieldRow>
          <FieldRow id="postscript-b" label="Variant B postscript">
            <input
              id="postscript-b"
              className="field"
              value={variant.postscript ?? ''}
              onChange={(event) => onChange({ ...variant, postscript: event.target.value || undefined })}
              placeholder="Same as variant A"
            />
          </FieldRow>
          <p className="helper">
            This row ({contact.row}) gets variant {current}.{variant.openerId ? ` B opener: ${variant.openerId}.` : ''}
          </p>
        </>
      )}
    </div>
  );
}
