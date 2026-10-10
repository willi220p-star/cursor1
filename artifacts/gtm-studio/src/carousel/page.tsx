// Carousel editor adapted from an MIT-licensed open-source LinkedIn carousel generator.
// Its licence and copyright notice are kept in ./LICENSE.
import Editor from "@/carousel/components/editor";
import { DocumentProvider } from "@/carousel/lib/providers/document-provider";

export function CarouselGeneratorPage({ userId }: { userId?: string }) {
  return (
    <div className="carousel-studio flex min-h-[calc(100dvh-4rem)] min-w-0 flex-col" data-studio="carousel">
      <DocumentProvider>
        <Editor userId={userId} />
      </DocumentProvider>
    </div>
  );
}
