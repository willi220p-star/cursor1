import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Info } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { publicAssetUrl } from '@/lib/utils';
import type { Contact } from '@/studio/types';

export function contactName(row: Contact) {
  const first = String(row.first_name || '').trim();
  if (first) return first;
  const full = String(row.name || row.full_name || '').trim();
  if (full) return full.split(/\s+/)[0] || full;
  return String(row.company || `Row ${row.row}`);
}

export function contactMeta(row: Contact) {
  return String(row.company || row.city || `Row ${row.row}`);
}

/** Portrait that keeps the last good image if a newer source fails to load. */
export function DurablePortrait({
  src,
  className,
  style,
  size,
}: {
  src: string;
  className?: string;
  style?: CSSProperties;
  size?: number;
}) {
  const lastGood = useRef(src);
  const [shown, setShown] = useState(src);
  useEffect(() => {
    if (!src) return;
    setShown(src);
  }, [src]);
  const display = publicAssetUrl(shown || lastGood.current);
  if (!display) return null;
  return (
    <img
      src={display}
      alt=""
      width={size}
      height={size}
      loading="lazy"
      decoding="async"
      className={className}
      style={style}
      onLoad={() => {
        lastGood.current = display;
      }}
      onError={() => {
        if (lastGood.current && lastGood.current !== shown) setShown(lastGood.current);
      }}
    />
  );
}

export function Section({ title, hint, children }: { title?: string; hint?: string; children: ReactNode }) {
  return (
    <section className="section">
      {(title || hint) && (
        <div>
          {title && <h3>{title}</h3>}
          {hint && <p className="helper mt-1">{hint}</p>}
        </div>
      )}
      {children}
    </section>
  );
}

export function FieldRow({ id, label, hint, children }: { id?: string; label: ReactNode; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="field-row">
      <label className="label" htmlFor={id}>{label}</label>
      {children}
      {hint && <p className="helper mt-2">{hint}</p>}
    </div>
  );
}

export function SliderField({
  id,
  label,
  value,
  display,
  min,
  max,
  step,
  onChange,
}: {
  id: string;
  label: string;
  value: number;
  display?: string;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
}) {
  return (
    <div className="field-row">
      <div className="slider-head">
        <label className="label !mb-0" htmlFor={id}>{label}</label>
        <output className="value" htmlFor={id}>{display ?? value}</output>
      </div>
      <input id={id} type="range" min={min} max={max} step={step} value={value} onChange={(event) => onChange(Number(event.target.value))} />
    </div>
  );
}

export function ColorField({ id, label, value, onChange }: { id: string; label: string; value: string; onChange: (value: string) => void }) {
  return (
    <div className="field-row">
      <label className="label" htmlFor={id}>{label}</label>
      <div className="flex items-center gap-2">
        <input id={id} type="color" value={value} onChange={(event) => onChange(event.target.value)} className="w-14 flex-none" aria-describedby={`${id}-hex`} />
        <span id={`${id}-hex`} className="mono text-sm text-muted-foreground">{value.toUpperCase()}</span>
      </div>
    </div>
  );
}

export function InfoTip({ children, label = 'More information' }: { children: ReactNode; label?: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button type="button" className="inline-flex h-10 w-10 items-center justify-center rounded-md text-muted-foreground hover:bg-surface-2 hover:text-foreground" aria-label={label}>
          <Info size={16} aria-hidden />
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-[280px] rounded-md bg-foreground px-3 py-2 text-sm leading-relaxed text-background">{children}</TooltipContent>
    </Tooltip>
  );
}

export function FileButton({
  className = 'btn btn-quiet',
  accept,
  onChange,
  children,
  multiple,
}: {
  className?: string;
  accept: string;
  onChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
  children: ReactNode;
  multiple?: boolean;
}) {
  return (
    <label className={`${className} relative`}>
      {children}
      <input type="file" className="sr-only" accept={accept} onChange={onChange} multiple={multiple} />
    </label>
  );
}

export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
