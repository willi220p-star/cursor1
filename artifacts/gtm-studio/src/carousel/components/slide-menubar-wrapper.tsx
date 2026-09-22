"use client";
import {
  DocumentFormReturn,
  SlidesFieldArrayReturn,
} from "@/carousel/lib/document-form-types";
import { cn } from "@/carousel/lib/utils";

import { useSelectionContext } from "@/carousel/lib/providers/selection-context";
import SlideMenubar from "@/carousel/components/slide-menubar";

export default function SlideMenubarWrapper({
  // slidesFieldArray,
  fieldName, //TODO Maybe change with number or expose onclciks
  slidesFieldArray,
  children,
  className = "",
}: //
{
  // slidesFieldArray: SlidesFieldArrayReturn;
  fieldName: string;
  slidesFieldArray: SlidesFieldArrayReturn;
  children: React.ReactNode;
  className?: string;
}) {
  const { currentSelection } = useSelectionContext();

  // const { remove, swap, insert } = slidesFieldArray;
  return (
    <div className="relative w-fit px-2" id={"slide-wrapper-" + fieldName}>
      <div
        id={`slide-menubar-${fieldName}`}
        className={cn(
          "absolute -top-10 right-0 ",
          // currentSelection != fieldName && "hidden",
          className
        )}
      >
        <SlideMenubar
          slidesFieldArray={slidesFieldArray}
          fieldName={fieldName}
          className="mr-2"
        />
      </div>
      {children}
    </div>
  );
}
