import { useFormContext } from "react-hook-form";

import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/carousel/components/ui/form";
import { Input } from "@/carousel/components/ui/input";
import { cn } from "@/carousel/lib/utils";
import { Textarea } from "@/carousel/components/ui/textarea";
import { DocumentFormReturn } from "@/carousel/lib/document-form-types";

export function FilenameForm({ className = "" }: { className?: string }) {
  const form: DocumentFormReturn = useFormContext(); // retrieve those props

  return (
    <Form {...form}>
      <form className="">
        <FormField
          control={form.control}
          name="filename"
          render={({ field }) => (
            <FormItem>
              <FormControl>
                <Input
                  placeholder="Untitled Carousel"
                  className={cn(
                    "py-0 h-8 border-none text-right text-base font-semibold",
                    className
                  )}
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      </form>
    </Form>
  );
}
