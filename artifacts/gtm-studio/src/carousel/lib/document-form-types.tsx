import {
  FieldPathByValue,
  UseFieldArrayReturn,
  UseFormReturn,
} from "react-hook-form";
import * as z from "zod";
import { DocumentSchema } from "@/carousel/lib/validation/document-schema";
import {
  CommonSlideSchema,
  ElementSchema,
} from "@/carousel/lib/validation/slide-schema";
import { TextStyleSchema } from "@/carousel/lib/validation/text-schema";

export type DocumentFormReturn = UseFormReturn<z.infer<typeof DocumentSchema>>;

export type SlidesFieldArrayReturn = UseFieldArrayReturn<
  z.infer<typeof DocumentSchema>,
  "slides"
>;

export type ElementsFieldArrayReturn = UseFieldArrayReturn<
  z.infer<typeof CommonSlideSchema>,
  `elements` // TODO: This shouldn't be 0, it should be generic
>;

export type SlideFieldPath = `slides.${number}`;

export type TextFieldPath =
  | `slides.${number}.title`
  | `slides.${number}.subtitle`
  | `slides.${number}.description`;

export type TextTextFieldPath = `slides.${number}.elements.${number}.text`;
export type StyleFieldPath = `slides.${number}.elements.${number}.style`;

export type TextStyleFontSizeFieldPath =
  `slides.${number}.elements.${number}.style.fontSize`;
export type TextStyleAlignFieldPath =
  `slides.${number}.elements.${number}.style.align`;
export type TextFieldStyle = z.infer<typeof TextStyleSchema>;

export type ElementFieldPath = FieldPathByValue<
  z.infer<typeof DocumentSchema>,
  z.infer<typeof ElementSchema>
>;
export type ElementArrayFieldPath = `slides.${number}.elements`;

export type ImageFieldPath =
  | `slides.${number}.elements.${number}`
  | `slides.${number}.backgroundImage`
  | "config.brand.avatar";

export type ImageSourceFieldPath =
  | `slides.${number}.elements.${number}.source`
  | `slides.${number}.backgroundImage.source`
  | "config.brand.avatar.source";
export type ImageSourceSrcFieldPath =
  | `slides.${number}.elements.${number}.source.src`
  | `slides.${number}.backgroundImage.source.src`
  | "config.brand.avatar.source.src";

export type ImageStyleOpacityFieldPath =
  | `slides.${number}.elements.${number}.style.opacity`
  | `slides.${number}.backgroundImage.style.opacity`
  | "config.brand.avatar.style.opacity";

export type ImageStyleObjectFitFieldPath =
  | `slides.${number}.elements.${number}.style.objectFit`;
