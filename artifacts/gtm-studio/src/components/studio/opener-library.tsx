import { BookOpen } from 'lucide-react';
import { useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { renderMerge } from '@/studio/merge';
import { countWords } from '@/studio/note-advice';
import { openerCategories, openerLibrary, postscriptCategories, postscriptLibrary } from '@/studio/opener-library';
import type { Contact } from '@/studio/types';

type Kind = 'openers' | 'postscripts';

export function OpenerLibrary({
  contact,
  onUseMessage,
  onUsePostscript,
  onUseVariantB,
}: {
  contact: Contact;
  onUseMessage: (body: string, title: string, id: string) => void;
  onUsePostscript: (text: string, title: string) => void;
  /** When set, openers also offer "Use as variant B" for an A/B split. */
  onUseVariantB?: (body: string, title: string, id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<Kind>('openers');
  const [category, setCategory] = useState('All');

  const categories: readonly string[] = kind === 'openers' ? openerCategories : postscriptCategories;
  const entries = (kind === 'openers' ? openerLibrary : postscriptLibrary)
    .filter((item) => category === 'All' || item.category === category);

  const chooseKind = (next: Kind) => {
    setKind(next);
    setCategory('All');
  };

  const use = (body: string, title: string, id: string) => {
    if (kind === 'openers') onUseMessage(body, title, id);
    else onUsePostscript(body, title);
    setOpen(false);
  };

  const useAsB = (body: string, title: string, id: string) => {
    onUseVariantB?.(body, title, id);
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button type="button" className="btn btn-quiet">
          <BookOpen size={16} aria-hidden /> Opener library
        </button>
      </DialogTrigger>
      <DialogContent className="opener-library w-[min(720px,calc(100vw-32px))] max-w-none rounded-[12px] border-border bg-card p-5 shadow-[var(--shadow-overlay)] sm:p-6 [&>button]:right-3 [&>button]:top-3 [&>button]:h-11 [&>button]:w-11 [&>button]:rounded-md [&>button]:opacity-100 [&>button>svg]:mx-auto [&>button>svg]:h-5 [&>button>svg]:w-5">
        <DialogHeader className="pr-12 text-left">
          <DialogTitle className="display text-2xl font-semibold">Opener library</DialogTitle>
          <DialogDescription className="text-sm">
            Short notes that get replies. Shown for the current row; blank cells fall back to natural wording.
          </DialogDescription>
        </DialogHeader>
        <div className="opener-library-kinds" role="group" aria-label="Library">
          <button type="button" className="option-chip" aria-pressed={kind === 'openers'} data-state={kind === 'openers' ? 'on' : 'off'} onClick={() => chooseKind('openers')}>
            Openers <span className="opener-library-count">{openerLibrary.length}</span>
          </button>
          <button type="button" className="option-chip" aria-pressed={kind === 'postscripts'} data-state={kind === 'postscripts' ? 'on' : 'off'} onClick={() => chooseKind('postscripts')}>
            P.S. lines <span className="opener-library-count">{postscriptLibrary.length}</span>
          </button>
        </div>
        <div className="opener-library-filters" role="group" aria-label="Category">
          {['All', ...categories].map((item) => (
            <button
              key={item}
              type="button"
              className="tag-chip"
              aria-pressed={category === item}
              data-state={category === item ? 'on' : 'off'}
              onClick={() => setCategory(item)}
            >
              {item}
            </button>
          ))}
        </div>
        <ul className="opener-library-list" aria-label={kind === 'openers' ? 'Openers' : 'P.S. lines'}>
          {entries.map((item) => {
            const rendered = renderMerge(item.body, contact);
            const words = countWords(rendered);
            return (
              <li key={item.id} className="opener-card">
                <div className="opener-card-head">
                  <h3 className="opener-card-title">{item.title}</h3>
                  <span className="mono text-xs text-muted-foreground">{words} words</span>
                </div>
                {category === 'All' && <p className="opener-card-category">{item.category}</p>}
                <p className="opener-card-body">{rendered}</p>
                <p className="helper text-[13px]">{item.why}</p>
                <div className="opener-card-actions">
                  <button
                    type="button"
                    className="btn btn-quiet opener-card-use"
                    aria-label={`${kind === 'openers' ? 'Use as message' : 'Use as P.S.'}: ${item.title}`}
                    onClick={() => use(item.body, item.title, item.id)}
                  >
                    {kind === 'openers' ? 'Use as message' : 'Use as P.S.'}
                  </button>
                  {kind === 'openers' && onUseVariantB && (
                    <button
                      type="button"
                      className="btn btn-quiet opener-card-use"
                      aria-label={`Use as variant B: ${item.title}`}
                      onClick={() => useAsB(item.body, item.title, item.id)}
                    >
                      Use as variant B
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
