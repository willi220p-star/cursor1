import React from "react";
import { cn } from "@/carousel/lib/utils";
import { usePagerContext } from "@/carousel/lib/providers/pager-context";
import { getSlideNumber } from "@/carousel/lib/field-path";
import { useSelection } from "@/carousel/lib/hooks/use-selection";
import { useSelectionContext } from "@/carousel/lib/providers/selection-context";

export function PageLayout({
  children,
  fieldName,
  className,
}: {
  children: React.ReactNode;
  fieldName: string;
  className?: string;
}) {
  const { setCurrentPage } = usePagerContext();
  const { setCurrentSelection } = useSelectionContext();
  const pageNumber = getSlideNumber(fieldName);

  return (
    <div
      className={cn(
        "flex flex-col justify-center grow items-stretch",
        className
      )}
      onClick={(event) => {
        setCurrentPage(pageNumber);
        setCurrentSelection(fieldName, event);
      }}
    >
      {children}
    </div>
  );
}
