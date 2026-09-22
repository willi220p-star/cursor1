import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
const mod = isMac ? '⌘' : 'Ctrl';

const shortcuts: { keys: string[]; label: string }[] = [
  { keys: ['←', '→'], label: 'Previous / next prospect row' },
  { keys: [mod, 'S'], label: 'Save campaign' },
  { keys: [mod, 'Enter'], label: 'Generate the batch (or cancel a running one)' },
  { keys: ['1', '2', '3'], label: 'Copy / Look / Ship tab' },
  { keys: ['I'], label: 'Import a prospect list' },
  { keys: ['Esc'], label: 'Leave crop mode or close a dialog' },
  { keys: ['?'], label: 'Show this list' },
];

export function ShortcutsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(480px,calc(100vw-32px))] rounded-[12px] border-border bg-card p-6 shadow-[var(--shadow-overlay)] [&>button]:right-4 [&>button]:top-4 [&>button]:h-11 [&>button]:w-11 [&>button]:rounded-md [&>button]:opacity-100 [&>button>svg]:mx-auto [&>button>svg]:h-5 [&>button>svg]:w-5">
        <DialogHeader className="pr-12 text-left">
          <DialogTitle className="display text-2xl font-semibold">Keyboard shortcuts</DialogTitle>
          <DialogDescription className="text-sm">Shortcuts work when the focus is not inside a text field.</DialogDescription>
        </DialogHeader>
        <dl className="mt-2 divide-y divide-border">
          {shortcuts.map((item) => (
            <div key={item.label} className="flex items-center justify-between gap-4 py-3">
              <dt className="text-sm">{item.label}</dt>
              <dd className="flex flex-none gap-1">
                {item.keys.map((key) => (
                  <kbd key={key} className="mono inline-flex h-8 min-w-8 items-center justify-center rounded-[6px] border border-input bg-surface-2 px-2 text-sm">{key}</kbd>
                ))}
              </dd>
            </div>
          ))}
        </dl>
      </DialogContent>
    </Dialog>
  );
}
