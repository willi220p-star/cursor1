import { useMemo, useState } from 'react';
import { Building2, Check, ChevronDown, Layers } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { clientSpaceId, isStaff } from '@/studio/access';
import { spaceName, useAccess } from '@/studio/access-context';
import { sortSpaces } from '@/studio/spaces';

const SEARCH_FROM = 8;

/**
 * Staff: pick All spaces, Internal or one client space (search appears past eight options).
 * Client users: their space's name, nothing to change. Hidden when no spaces exist (local mode).
 */
export function SpaceSwitcher({ onChange }: { onChange?: () => void }) {
  const { orgRole, spaces, memberships, currentSpaceId, setCurrentSpace } = useAccess();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const options = useMemo(() => sortSpaces(spaces.filter((space) => !space.archived_at)), [spaces]);

  if (!spaces.length) return null;

  if (!isStaff(orgRole)) {
    const own = clientSpaceId(memberships, spaces);
    return (
      <span className="nav-search space-name" data-testid="space-name" title="Your space">
        <Building2 size={15} aria-hidden />
        <span className="max-w-[180px] truncate">{spaceName(spaces, own)}</span>
      </span>
    );
  }

  const needle = query.trim().toLowerCase();
  const visible = needle ? options.filter((space) => space.name.toLowerCase().includes(needle)) : options;
  const label = spaceName(spaces, currentSpaceId);
  const pick = (id: string | null) => {
    setCurrentSpace(id);
    setOpen(false);
    setQuery('');
    onChange?.();
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" className="nav-search space-switcher" aria-label={`Space: ${label}. Change space`} data-testid="space-switcher">
          <Layers size={15} aria-hidden />
          <span className="max-w-[160px] truncate">{label}</span>
          <ChevronDown size={14} aria-hidden />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 border-border bg-popover p-2">
        {options.length + 1 > SEARCH_FROM && (
          <input
            type="search"
            className="field mb-2 w-full"
            placeholder="Find a space"
            aria-label="Find a space"
            value={query}
            autoFocus
            onChange={(event) => setQuery(event.target.value)}
          />
        )}
        <ul className="flex max-h-80 flex-col gap-0.5 overflow-y-auto" role="listbox" aria-label="Spaces">
          {!needle && (
            <li>
              <SpaceOption label="All spaces" hint="Everything you can see" selected={currentSpaceId === null} onPick={() => pick(null)} />
            </li>
          )}
          {visible.map((space) => (
            <li key={space.id}>
              <SpaceOption
                label={space.name}
                hint={space.kind === 'internal' ? 'DGK internal' : 'Client space'}
                selected={currentSpaceId === space.id}
                onPick={() => pick(space.id)}
              />
            </li>
          ))}
          {needle && !visible.length && <li className="px-3 py-2 text-sm text-muted-foreground">No space matches.</li>}
        </ul>
      </PopoverContent>
    </Popover>
  );
}

function SpaceOption({ label, hint, selected, onPick }: { label: string; hint: string; selected: boolean; onPick: () => void }) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      onClick={onPick}
      className="flex min-h-11 w-full items-center gap-3 rounded-[10px] px-3 text-left text-sm hover:bg-fill focus-visible:bg-fill focus-visible:outline-none"
    >
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium">{label}</span>
        <span className="block truncate text-xs text-muted-foreground">{hint}</span>
      </span>
      {selected && <Check size={16} aria-hidden />}
    </button>
  );
}
