import React from "react";
import { SidebarPanel } from "@/carousel/components/settings-panel";
import { SlidesEditor } from "@/carousel/components/slides-editor";
import { CarouselHeader } from "@/carousel/components/carousel-header";
import { RefProvider } from "@/carousel/lib/providers/reference-context";
import { StudioProvider } from "@/carousel/lib/providers/studio-context";

export default function Editor({ userId }: { userId?: string }) {
  const componentRef = React.useRef<HTMLDivElement>(null);

  return (
    <StudioProvider userId={userId}>
      <RefProvider myRef={componentRef}>
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="carousel-toolbar px-4 pb-3 pt-5 md:px-8 md:pt-8">
            <CarouselHeader />
          </div>
          <div className="carousel-workspace flex min-w-0 flex-1 flex-col border-t border-border md:grid md:grid-cols-[360px_minmax(0,1fr)]">
            <SidebarPanel userId={userId} />
            <SlidesEditor />
          </div>
        </div>
      </RefProvider>
    </StudioProvider>
  );
}
