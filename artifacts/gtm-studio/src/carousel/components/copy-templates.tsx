import { useFormContext } from 'react-hook-form';
import { toast } from 'sonner';
import { CopyTemplateControls } from '@/components/studio/copy-template-controls';
import type { DocumentFormReturn, TextTextFieldPath } from '@/carousel/lib/document-form-types';
import { usePagerContext } from '@/carousel/lib/providers/pager-context';
import { useSelectionContext } from '@/carousel/lib/providers/selection-context';

const textTypes = new Set(['Title', 'Subtitle', 'Description']);

export function CarouselCopyTemplates({ userId }: { userId?: string }) {
  const form: DocumentFormReturn = useFormContext();
  const { currentPage } = usePagerContext();
  const { currentSelection } = useSelectionContext();

  return (
    <CopyTemplateControls
      studio="carousel"
      userId={userId}
      hint="Choosing a template fills the selected text, or the description on this slide."
      onApply={(body) => {
        const slides = form.getValues('slides');
        const selected = currentSelection.startsWith('slides.')
          ? form.getValues(currentSelection as `slides.${number}.elements.${number}`)
          : null;
        let path: TextTextFieldPath | '' = '';
        if (selected && typeof selected === 'object' && 'text' in selected && textTypes.has(String(selected.type))) {
          path = `${currentSelection}.text` as TextTextFieldPath;
        } else {
          const elements = slides[currentPage]?.elements ?? [];
          const description = elements.findIndex((element) => element.type === 'Description');
          const text = description >= 0 ? description : elements.findIndex((element) => textTypes.has(element.type));
          if (text >= 0) path = `slides.${currentPage}.elements.${text}.text`;
        }
        if (!path) {
          toast('This slide has no text to fill');
          return;
        }
        form.setValue(path, body, { shouldDirty: true, shouldTouch: true });
      }}
    />
  );
}
