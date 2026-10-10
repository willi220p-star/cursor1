import { useEffect } from "react";
import { useFieldArray, useFormContext } from "react-hook-form";
import { DocumentFormReturn, SlidesFieldArrayReturn } from "@/carousel/lib/document-form-types";
import { Document } from "./pages/document";
import useWindowDimensions from "@/carousel/lib/hooks/use-window-dimensions";
import { SIZE } from "@/carousel/lib/page-size";
import { useSelectionContext } from "@/carousel/lib/providers/selection-context";
import { useStatusContext } from "@/carousel/lib/providers/editor-status-context";
import { DocumentSkeleton } from "@/carousel/components/editor-skeleton";

export function SlidesEditor() {
  const form: DocumentFormReturn = useFormContext();
  const { control, watch } = form;
  const document = watch();
  const { width } = useWindowDimensions();
  const windowWidth = width || 0;
  const isLoadingWidth = !windowWidth;
  const slidesFieldArray: SlidesFieldArrayReturn = useFieldArray({
    control,
    name: "slides",
  });
  const { setCurrentSelection } = useSelectionContext();
  const { status, setStatus } = useStatusContext();

  useEffect(() => {
    setStatus("ready");
  }, [setStatus]);

  // Wider screens show smaller slides because the settings sidebar takes room.
  const mdWindowWidthPx = 770;
  const screenToSlideMinRatio = windowWidth > mdWindowWidthPx ? 2.5 : 1.2;
  const scale = Math.min(1, windowWidth / screenToSlideMinRatio / SIZE.width);

  return (
    <div
      className="carousel-stage flex min-w-0 flex-1 flex-col items-center justify-start overflow-hidden"
      onClick={(event) => {
        // Only clear selection if this element started the event
        setCurrentSelection("", event);
      }}
    >
      <div className="flex w-full flex-col items-center justify-start px-2 py-6 md:px-4 md:py-10">
        {isLoadingWidth || status == "loading" ? (
          <DocumentSkeleton />
        ) : (
          <Document document={document} slidesFieldArray={slidesFieldArray} scale={scale} />
        )}
      </div>
    </div>
  );
}
