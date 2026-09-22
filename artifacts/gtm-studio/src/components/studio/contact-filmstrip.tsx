import { ArrowLeft, ArrowRight, List } from 'lucide-react';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import type { Contact } from '@/studio/types';
import { DurablePortrait, contactMeta, contactName } from './shared';

const VISIBLE = 16;

export function ContactFilmstrip({
  contacts,
  selectedRow,
  onSelect,
  portraitFor,
  onOpenList,
}: {
  contacts: Contact[];
  selectedRow: number;
  onSelect: (index: number) => void;
  portraitFor: (row: Contact) => string;
  onOpenList: () => void;
}) {
  const total = contacts.length;
  const hidden = Math.max(0, total - VISIBLE);
  return (
    <div className="filmstrip">
      <ScrollArea className="min-w-0 flex-1">
        <ToggleGroup
          type="single"
          value={String(selectedRow)}
          onValueChange={(value) => {
            if (value) onSelect(Number(value));
          }}
          aria-label="Prospect rows"
          className="filmstrip-track justify-start"
        >
          {contacts.slice(0, VISIBLE).map((row, index) => {
            const portrait = portraitFor(row);
            return (
              <ToggleGroupItem
                key={`${row.row}-${index}`}
                value={String(index)}
                aria-label={`Row ${index + 1}: ${contactName(row)}, ${contactMeta(row)}`}
                onFocus={() => {
                  if (index !== selectedRow) onSelect(index);
                }}
                className="contact-pill h-11 min-w-[140px] justify-start rounded-[6px] border-2 border-border bg-card px-3 text-foreground hover:bg-surface-2 hover:text-foreground data-[state=on]:border-primary data-[state=on]:bg-accent data-[state=on]:text-foreground"
              >
                {portrait && <DurablePortrait src={portrait} className="contact-pill-photo" size={28} />}
                <span className="min-w-0">
                  <strong>{contactName(row)}</strong>
                  <small>{contactMeta(row)}</small>
                </span>
              </ToggleGroupItem>
            );
          })}
          {hidden > 0 && (
            <button type="button" className="contact-pill justify-center gap-2 text-muted-foreground" onClick={onOpenList}>
              <List size={16} aria-hidden />
              <span><strong className="text-muted-foreground">+{hidden} more</strong><small>Open the list</small></span>
            </button>
          )}
          {total === 0 && (
            <button type="button" className="contact-pill justify-center gap-2 text-muted-foreground" onClick={onOpenList}>
              <List size={16} aria-hidden />
              <span><strong className="text-muted-foreground">No prospects yet</strong><small>Import a list or load a sample</small></span>
            </button>
          )}
        </ToggleGroup>
        <ScrollBar orientation="horizontal" />
      </ScrollArea>
      <div className="row-stepper" role="group" aria-label="Row navigation">
        <button type="button" className="btn btn-quiet btn-icon" aria-label="Previous row" disabled={selectedRow <= 0} onClick={() => onSelect(Math.max(0, selectedRow - 1))}><ArrowLeft size={16} aria-hidden /></button>
        <span className="count" aria-hidden>Row {Math.min(selectedRow + 1, Math.max(total, 1))} of {Math.max(total, 1)}</span>
        <button type="button" className="btn btn-quiet btn-icon" aria-label="Next row" disabled={selectedRow >= total - 1} onClick={() => onSelect(Math.min(total - 1, selectedRow + 1))}><ArrowRight size={16} aria-hidden /></button>
      </div>
    </div>
  );
}
