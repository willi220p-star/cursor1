/* eslint-disable @next/next/no-img-element */
import * as z from "zod";
import { cn } from "@/carousel/lib/utils";
import { fontIdToClassName } from "@/carousel/lib/fonts-map";
import { textStyleToClasses } from "@/carousel/lib/text-style-to-classes";
import { ObjectFitType } from "@/carousel/lib/validation/image-schema";
import type { ConfigSchema } from "@/carousel/lib/validation/document-schema";
import type { CommonSlideSchema } from "@/carousel/lib/validation/slide-schema";
import type { CarouselDocument } from "@/carousel/lib/personalise";
import { getPageSize } from "@/carousel/lib/page-size";
import Footer from "@/carousel/components/elements/footer";

type Config = z.infer<typeof ConfigSchema>;
type Slide = z.infer<typeof CommonSlideSchema>;

const TEXT_LOOK = {
  Title: { weight: "font-black", sizes: ["text-7xl", "text-5xl", "text-3xl"] as [string, string, string], font: "font1", color: "primary" },
  Subtitle: { weight: "font-bold", sizes: ["text-3xl", "text-2xl", "text-xl"] as [string, string, string], font: "font1", color: "secondary" },
  Description: { weight: "font-medium", sizes: ["text-xl", "text-lg", "text-base"] as [string, string, string], font: "font2", color: "secondary" },
} as const;

/**
 * A read-only slide with the same layout as the editor page, without form fields or selection
 * chrome. Exports and personalised previews render this, so what ships never shows editor UI.
 */
export function StaticSlide({
  config,
  slide,
  index,
  className,
}: {
  config: Config;
  slide: Slide;
  index: number;
  className?: string;
}) {
  const size = getPageSize(config.format);
  return (
    <div
      data-export-slide={index}
      className={cn("relative overflow-hidden", className)}
      style={{ width: size.width, height: size.height, minWidth: size.width, minHeight: size.height, backgroundColor: config.theme.background }}
    >
      {slide.backgroundImage?.source.src ? (
        <img
          alt=""
          src={slide.backgroundImage.source.src}
          crossOrigin="anonymous"
          className="absolute inset-0 h-full w-full object-cover"
          style={{ opacity: slide.backgroundImage.style.opacity / 100 }}
        />
      ) : null}
      <div className="relative flex h-full w-full flex-col p-10">
        <div className="flex grow flex-col items-stretch justify-center gap-2">
          {slide.elements.map((element, position) => {
            if (element.type === "Title" || element.type === "Subtitle" || element.type === "Description") {
              const look = TEXT_LOOK[element.type];
              return (
                <p
                  key={position}
                  className={cn(
                    "m-0 w-full whitespace-pre-wrap break-words p-0",
                    look.weight,
                    textStyleToClasses({ style: element.style, sizes: look.sizes }),
                    fontIdToClassName(config.fonts[look.font]),
                  )}
                  style={{ color: config.theme[look.color] }}
                >
                  {element.text || " "}
                </p>
              );
            }
            if (element.type === "ContentImage") {
              return (
                <div key={position} className="flex h-40 w-full flex-col">
                  {element.source.src ? (
                    <img
                      alt=""
                      src={element.source.src}
                      crossOrigin="anonymous"
                      className={cn(
                        "overflow-hidden rounded-md",
                        element.style.objectFit === ObjectFitType.enum.Cover ? "h-full w-full object-cover" : "h-fit w-fit object-contain",
                      )}
                      style={{ opacity: element.style.opacity / 100 }}
                    />
                  ) : null}
                </div>
              );
            }
            return null;
          })}
        </div>
        <Footer number={index + 1} config={config} />
      </div>
    </div>
  );
}

export function StaticDeck({ document, className }: { document: CarouselDocument; className?: string }) {
  return (
    <div className={cn("flex flex-col", className)}>
      {document.slides.map((slide, index) => (
        <StaticSlide key={index} config={document.config} slide={slide} index={index} />
      ))}
    </div>
  );
}
