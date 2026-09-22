import React from "react";
import * as z from "zod";
import { ConfigSchema } from "@/carousel/lib/validation/document-schema";
import { cn } from "@/carousel/lib/utils";
import { fontIdToClassName } from "@/carousel/lib/fonts-map";
import { TitleSchema } from "@/carousel/lib/validation/text-schema";
import { textStyleToClasses } from "@/carousel/lib/text-style-to-classes";
import { useFormContext } from "react-hook-form";
import {
  DocumentFormReturn,
  TextFieldPath,
  TextFieldStyle,
  StyleFieldPath,
  TextTextFieldPath,
} from "@/carousel/lib/document-form-types";
import { TextAreaFormField } from "@/carousel/components/forms/fields/text-area-form-field";

export function Title({
  fieldName,
  className = "",
}: {
  fieldName: TextFieldPath;
  className?: string;
}) {
  const form: DocumentFormReturn = useFormContext();
  const { getValues } = form;
  const config = getValues("config");
  const style = getValues(
    `${fieldName}.style` as StyleFieldPath
  ) as TextFieldStyle;
  const textFieldName = (fieldName + ".text") as TextTextFieldPath;
  return (
    <TextAreaFormField
      fieldName={textFieldName}
      form={form}
      label={""}
      placeholder={"Your title here"}
      className={cn(
        // text-balance has some issues with text area
        `font-black `,
        textStyleToClasses({
          style: style,
          sizes: ["text-7xl", "text-5xl", "text-3xl"],
        }),
        fontIdToClassName(config.fonts.font1),
        className
      )}
      style={{
        color: config.theme.primary,
      }}
    />
  );
}
