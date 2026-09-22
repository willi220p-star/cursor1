"use client";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import FormProvider from "@/carousel/lib/providers/form-provider";
import * as z from "zod";
import {
  useRetrieveFormValues,
  usePersistFormValues,
} from "@/carousel/lib/hooks/use-persist-form";

import { DocumentSchema } from "@/carousel/lib/validation/document-schema";
import { PagerProvider } from "@/carousel/lib/providers/pager-context";
import { usePager } from "@/carousel/lib/hooks/use-pager";
import { SelectionProvider } from "@/carousel/lib/providers/selection-context";
import { useSelection } from "@/carousel/lib/hooks/use-selection";
import { DocumentFormReturn } from "@/carousel/lib/document-form-types";
import { defaultValues } from "@/carousel/lib/default-document";
import { KeysProvider } from "@/carousel/lib/providers/keys-context";
import { useKeys } from "@/carousel/lib/hooks/use-keys";
import { StatusProvider } from "@/carousel/lib/providers/editor-status-context";

const FORM_DATA_KEY = "gtm-carousel-document";

export function DocumentProvider({ children }: { children: React.ReactNode }) {
  const { getSavedData } = useRetrieveFormValues(
    FORM_DATA_KEY,
    defaultValues,
    DocumentSchema
  );
  const documentForm: DocumentFormReturn = useForm<
    z.infer<typeof DocumentSchema>
  >({
    resolver: zodResolver(DocumentSchema),
    defaultValues: getSavedData(),
  });
  usePersistFormValues({
    localStorageKey: FORM_DATA_KEY,
    values: documentForm.watch(),
  });
  const keys = useKeys();

  const selection = useSelection();
  const pager = usePager(0);
  return (
    <KeysProvider value={keys}>
      <FormProvider {...documentForm}>
        <StatusProvider>
          <SelectionProvider value={selection}>
            <PagerProvider value={pager}>
              <div className="flex-1 flex flex-col">{children}</div>
            </PagerProvider>
          </SelectionProvider>
        </StatusProvider>
      </FormProvider>
    </KeysProvider>
  );
}
