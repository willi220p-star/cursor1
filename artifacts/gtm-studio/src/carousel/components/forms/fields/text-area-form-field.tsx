import { AutoTextarea } from "@/carousel/components/ui/auto-text-area";
import {
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/carousel/components/ui/form";
import {
  DocumentFormReturn,
  TextTextFieldPath,
} from "@/carousel/lib/document-form-types";
import { getParent, getSlideNumber } from "@/carousel/lib/field-path";
import { usePagerContext } from "@/carousel/lib/providers/pager-context";
import { useSelectionContext } from "@/carousel/lib/providers/selection-context";
import { CSSProperties } from "react";

export function TextAreaFormField({
  form,
  fieldName,
  label,
  placeholder,
  className = "",
  style = {},
}: {
  form: DocumentFormReturn;
  fieldName: TextTextFieldPath;
  label: string;
  placeholder: string;
  className?: string;
  style?: CSSProperties;
}) {
  const { setCurrentSelection } = useSelectionContext();
  const { setCurrentPage } = usePagerContext();
  const pageNumber = getSlideNumber(fieldName);

  return (
    <FormField
      control={form.control}
      name={fieldName}
      render={({ field }) => (
        <FormItem className={"space-y-0"}>
          <FormLabel>{label}</FormLabel>
          <FormControl>
            <AutoTextarea
              placeholder={placeholder}
              className={className}
              style={style}
              {...field}
              onFocus={(event) => {
                setCurrentSelection(getParent(fieldName), event);
                setCurrentPage(pageNumber);
              }}
              onClick={(event) => {
                event.stopPropagation();
              }}
              value={form.getValues(fieldName)}
              // TODO: Create currentHover
              // Link with onMouseEnter and onMouseLeave
            />
          </FormControl>
          <FormMessage />
        </FormItem>
      )}
    />
  );
}
