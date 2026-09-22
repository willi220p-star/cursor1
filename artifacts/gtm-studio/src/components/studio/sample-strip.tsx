import { useRef, type ChangeEvent, type KeyboardEvent } from 'react';
import { Check, Plus, Trash2 } from 'lucide-react';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';
import { publicAssetUrl } from '@/lib/utils';
import type { MemeSample } from '@/studio/meme-samples';
import { FileButton } from './shared';

const ACCEPT = 'image/gif,image/webp,image/png,image/jpeg,image/jpg';

export function SampleStrip({
  selectedSrc,
  samples,
  onPick,
  onAddLive,
  onClear,
  onRemove,
  clearLabel = 'Remove uploaded image',
}: {
  selectedSrc?: string;
  samples: MemeSample[];
  onPick: (sample: MemeSample) => void;
  onAddLive: (event: ChangeEvent<HTMLInputElement>) => void;
  onClear?: () => void;
  onRemove?: (sample: MemeSample) => void;
  clearLabel?: string;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const selectedIndex = Math.max(0, samples.findIndex((sample) => sample.src === selectedSrc));

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    const buttons = [...(trackRef.current?.querySelectorAll<HTMLElement>('[data-sample]') ?? [])];
    if (!buttons.length) return;
    const current = buttons.findIndex((button) => button === document.activeElement);
    let next = current;
    if (event.key === 'ArrowLeft') next = Math.max(0, current - 1);
    if (event.key === 'ArrowRight') next = Math.min(buttons.length - 1, current + 1);
    if (event.key === 'Home') next = 0;
    if (event.key === 'End') next = buttons.length - 1;
    if (next !== current && buttons[next]) {
      event.preventDefault();
      buttons[next].focus();
      buttons[next].click();
    }
  };

  return (
    <section className="film-reel" aria-labelledby="templates-heading">
      <div className="film-reel-head">
        <div>
          <p className="eyebrow">Templates</p>
          <h2 id="templates-heading" className="text-lg font-semibold">Templates, or drop in a live GIF</h2>
          <p className="helper mt-1">Pick a layout and edit the text. The picture stays.</p>
        </div>
        <FileButton className="btn btn-primary" accept={ACCEPT} onChange={onAddLive}>
          <Plus size={16} aria-hidden /> Add live GIF
        </FileButton>
        {onClear && (
          <button type="button" className="btn btn-danger" onClick={onClear}>
            <Trash2 size={16} aria-hidden /> {clearLabel}
          </button>
        )}
      </div>
      <ScrollArea>
        <div ref={trackRef} className="film-track" role="listbox" aria-label="Meme templates" aria-activedescendant={samples[selectedIndex] ? `sample-${samples[selectedIndex].id}` : undefined} onKeyDown={onKeyDown}>
          {samples.map((sample, index) => {
            const active = selectedSrc === sample.src;
            const motion = sample.live ? 'live gif' : sample.photoMotion && sample.photoMotion !== 'still' ? sample.photoMotion : sample.animation;
            return (
              <div
                key={`import-${sample.id}`}
                id={`sample-${sample.id}`}
                data-sample
                role="option"
                aria-selected={active}
                tabIndex={index === selectedIndex ? 0 : -1}
                className={`film-frame ${active ? 'is-active' : ''}`}
                onClick={() => onPick(sample)}
                onKeyDown={(event) => {
                  if (event.key !== 'Enter' && event.key !== ' ') return;
                  event.preventDefault();
                  onPick(sample);
                }}
              >
                <em className="motion-badge">{motion}</em>
                {active && <span className="film-check" aria-hidden><Check size={14} /></span>}
                {onRemove && sample.id.startsWith('local-') && (
                  <button
                    type="button"
                    className="film-remove"
                    aria-label={`Remove ${sample.name}`}
                    onClick={(event) => {
                      event.stopPropagation();
                      onRemove(sample);
                    }}
                  >
                    <Trash2 size={14} aria-hidden />
                  </button>
                )}
                <img src={publicAssetUrl(sample.src)} alt="" width={128} height={96} loading="lazy" decoding="async" />
                <span className="film-meta">
                  <strong>{sample.name}</strong>
                  <small>{sample.blurb}</small>
                </span>
              </div>
            );
          })}
          <FileButton className="film-frame film-frame-add" accept={ACCEPT} onChange={onAddLive}>
            <Plus size={20} aria-hidden />
            <strong className="text-sm font-semibold">Add your own</strong>
            <small className="text-xs text-muted-foreground">GIF, WEBP, PNG or JPG</small>
          </FileButton>
        </div>
        <ScrollBar orientation="horizontal" />
      </ScrollArea>
    </section>
  );
}
