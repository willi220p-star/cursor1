import { Section } from '@/components/studio/shared';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { applyAudience, audiencePreset, audiencePresets, matchAudience, RECOMMENDED_AUDIENCE, type AudienceId } from '@/studio/audience';
import type { StudioConfig } from '@/studio/types';

/**
 * "Made for": one click sets canvas, card framing and writing size for where the note gets read.
 * Shows "Custom" once size, canvas or framing has been changed by hand.
 */
export function AudiencePicker({
  config,
  setConfig,
}: {
  config: StudioConfig;
  setConfig: (update: (current: StudioConfig) => StudioConfig) => void;
}) {
  const active = matchAudience(config);
  const hint = active
    ? audiencePreset(active).hint
    : 'Custom: size, canvas or framing changed by hand. Pick one to reset all three.';
  return (
    <Section title="Made for">
      <ToggleGroup
        type="single"
        value={active ?? ''}
        onValueChange={(value) => value && setConfig((current) => applyAudience(current, value as AudienceId))}
        className="grid grid-cols-3 items-stretch gap-2"
        aria-label="Made for"
      >
        {audiencePresets.map((preset) => (
          <ToggleGroupItem
            key={preset.id}
            value={preset.id}
            title={preset.hint}
            className="option-chip h-auto min-h-10 rounded-[10px] px-1.5 py-1.5 sm:px-2 text-sm font-semibold leading-tight hover:text-foreground data-[state=on]:border-studio data-[state=on]:bg-studio/10 data-[state=on]:text-foreground"
          >
            {/* Non-breaking hyphen: "Phone-first" never splits across two lines on a phone. */}
            {preset.label.replace('-', '\u2011')}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      <p className="helper mt-2" aria-live="polite">
        {hint}
        {active !== RECOMMENDED_AUDIENCE && ` ${audiencePreset(RECOMMENDED_AUDIENCE).label} is recommended for cold email.`}
      </p>
    </Section>
  );
}
