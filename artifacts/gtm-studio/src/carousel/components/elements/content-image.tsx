/* eslint-disable @next/next/no-img-element */
import React from "react";
import * as z from "zod";
import { cn } from "@/carousel/lib/utils";
import {
  ObjectFitType,
  ImageSchema,
  ContentImageSchema,
} from "@/carousel/lib/validation/image-schema";
import { useSelectionContext } from "@/carousel/lib/providers/selection-context";
import { getSlideNumber } from "@/carousel/lib/field-path";
import { usePagerContext } from "@/carousel/lib/providers/pager-context";
import { useFormContext } from "react-hook-form";
import {
  DocumentFormReturn,
  ElementFieldPath,
} from "@/carousel/lib/document-form-types";

// Drawn locally so an empty image slot never depends on a placeholder service.
const IMAGE_PLACEHOLDER =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="200" viewBox="0 0 400 200"><rect width="400" height="200" fill="#e5e5e5"/><path d="M170 120l20-24 16 18 12-14 22 20z" fill="#a3a3a3"/><circle cx="182" cy="82" r="8" fill="#a3a3a3"/><text x="200" y="160" font-family="sans-serif" font-size="13" fill="#737373" text-anchor="middle">Add an image in Style</text></svg>'
  );

export function ContentImage({
  fieldName,
  className,
}: {
  fieldName: ElementFieldPath;
  className?: string;
}) {
  const form: DocumentFormReturn = useFormContext();
  const { getValues } = form;
  const image = getValues(fieldName) as z.infer<typeof ContentImageSchema>;

  const { setCurrentPage } = usePagerContext();
  const { currentSelection, setCurrentSelection } = useSelectionContext();
  const pageNumber = getSlideNumber(fieldName);
  const source = image.source.src || IMAGE_PLACEHOLDER;

  // TODO: Convert to Toggle to make it accessible. Control with selection

  return (
    <div
      id={"content-image-" + fieldName}
      className={cn(
        "flex flex-col h-full w-full outline-transparent rounded-md ring-offset-background",
        currentSelection == fieldName &&
          "outline-input ring-2 ring-offset-2 ring-ring",
        className
      )}
    >
      {/* // TODO: Extract to component */}
      <img
        alt="slide image"
        src={source} // TODO: Extract cover/contain into a setting for images
        className={cn(
          // shadow-md or any box shadow not supported by html2canvas
          "rounded-md overflow-hidden",
          image.style.objectFit == ObjectFitType.enum.Cover
            ? "object-cover w-full h-full"
            : image.style.objectFit == ObjectFitType.enum.Contain
            ? "object-contain w-fit h-fit"
            : ""
        )}
        style={{
          opacity: image.style.opacity / 100,
        }}
        onClick={(event) => {
          setCurrentPage(pageNumber);
          setCurrentSelection(fieldName, event);
        }}
      />
    </div>
  );
}
