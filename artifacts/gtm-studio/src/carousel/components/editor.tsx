"use client";

import { SidebarPanel } from "@/carousel/components/settings-panel";
import { SlidesEditor } from "@/carousel/components/slides-editor";
import React from "react";
import { useComponentPrinter } from "@/carousel/lib/hooks/use-component-printer";

import { RefProvider } from "@/carousel/lib/providers/reference-context";
import { MainNav } from "./main-nav";

export default function Editor({ userId }: { userId?: string }) {
  const { componentRef, handlePrint, isPrinting } = useComponentPrinter();

  return (
    <RefProvider myRef={componentRef}>
      <div className="flex-1 flex flex-col">
        <MainNav
          className="h-14 border-b px-6 "
          handlePrint={handlePrint}
          isPrinting={isPrinting}
        />
        <div className="flex-1 flex flex-start  md:grid md:grid-cols-[320px_minmax(0,1fr)] ">
          <SidebarPanel userId={userId} />
          <SlidesEditor />
        </div>
      </div>
    </RefProvider>
  );
}
