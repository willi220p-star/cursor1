import { DocumentFormReturn } from "@/carousel/lib/document-form-types";
import { useEffect, useState } from "react";
import { useFormContext } from "react-hook-form";
import { Input } from "./ui/input";
import { ConfigSchema } from "@/carousel/lib/validation/document-schema";
import { MultiSlideSchema } from "@/carousel/lib/validation/slide-schema";
import FileInputForm from "./forms/file-input-form";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "./ui/dialog";
import { useFieldsFileImporter } from "@/carousel/lib/hooks/use-fields-file-importer";

export function JsonImporter({
  fields,
  children,
}: {
  fields: "config" | "slides";
  children?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);

  const { handleFileSubmission } = useFieldsFileImporter(fields);
  // TODO: Make this component more generic by splitting dependencies of config and slides

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger>Open</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Load a file with Config/Content</DialogTitle>
        </DialogHeader>

        <FileInputForm
          handleSubmit={handleFileSubmission}
          label={"Input File"}
          description="Select a json file to load"
        />
      </DialogContent>
    </Dialog>
  );
}
