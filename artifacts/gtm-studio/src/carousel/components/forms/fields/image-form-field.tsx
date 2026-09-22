import {
  DocumentFormReturn,
  ImageFieldPath,
  ImageStyleOpacityFieldPath,
} from "@/carousel/lib/document-form-types";
import { ImageSourceFormField } from "@/carousel/components/forms/fields/image-source-form-field";
import { OpacityFormField } from "@/carousel/components/forms/fields/opacity-form-field";

export function ImageFormField({
  fieldName,
  form,
  label,
}: {
  fieldName: ImageFieldPath;
  form: DocumentFormReturn;
  label: string;
}) {
  return (
    <>
      <h3 className="text-base">{label}</h3>
      <ImageSourceFormField fieldName={`${fieldName}.source`} form={form} />
      <OpacityFormField
        fieldName={`${fieldName}.style.opacity` as ImageStyleOpacityFieldPath}
        form={form}
        label={"Opacity"}
        disabled={form.getValues(`${fieldName}.source.src`) == ""}
      />
    </>
  );
}
