import { Plus } from 'lucide-react';
import { FieldRow } from '@/components/studio/shared';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { renderMerge, resolveHookColumn } from '@/studio/merge';
import type { Contact, HookMark } from '@/studio/types';

const hookMarks: { id: HookMark; label: string; hint: string }[] = [
  { id: 'underline', label: 'Underline', hint: 'A quick pen line under the hook' },
  { id: 'circle', label: 'Circle', hint: 'A loose ring round it (underline if it wraps)' },
  { id: 'none', label: 'None', hint: 'Write it plain' },
];

/** Note copy: which column is the personal hook, and how the pen marks it on the note. */
export function HookControls({
  columns,
  contact,
  copy,
  hookColumn,
  hookMark,
  onColumn,
  onMark,
  onInsert,
}: {
  columns: string[];
  contact: Contact;
  copy: string;
  hookColumn?: string;
  hookMark?: HookMark;
  onColumn: (column: string | undefined) => void;
  onMark: (mark: HookMark) => void;
  onInsert: () => void;
}) {
  const guessed = hookColumn ? '' : resolveHookColumn(contact);
  const usesHook = /\{\s*hook\s*(\||\})/i.test(copy);
  const preview = usesHook ? renderMerge('{hook}', contact, { hookColumn }) : '';
  return (
    <FieldRow
      id="hook-column"
      label="Personal hook"
      hint={usesHook
        ? (preview ? <>This row: <span className="text-foreground">{preview}</span></> : 'This row has no hook, so it writes blank. Add a fallback like {hook|your line}.')
        : 'Put {hook} in the message where the personal line goes. The pen marks it on every note.'}
    >
      <div className="flex gap-2">
        <select id="hook-column" className="field" value={hookColumn ?? ''} onChange={(event) => onColumn(event.target.value || undefined)}>
          <option value="">{guessed ? `Auto (${guessed})` : 'Auto'}</option>
          {columns.map((column) => <option key={column}>{column}</option>)}
        </select>
        {!usesHook && (
          <button type="button" className="btn btn-quiet flex-none" onClick={onInsert}><Plus size={16} aria-hidden /> Insert {'{hook}'}</button>
        )}
      </div>
      <ToggleGroup type="single" value={hookMark ?? 'underline'} onValueChange={(value) => value && onMark(value as HookMark)} className="mt-2 grid grid-cols-3 gap-2" aria-label="Hook mark">
        {hookMarks.map((mark) => (
          <ToggleGroupItem key={mark.id} value={mark.id} title={mark.hint} className="option-chip h-10 rounded-[10px] px-2 text-sm font-semibold hover:text-foreground data-[state=on]:border-studio data-[state=on]:bg-studio/10 data-[state=on]:text-foreground">{mark.label}</ToggleGroupItem>
        ))}
      </ToggleGroup>
    </FieldRow>
  );
}
