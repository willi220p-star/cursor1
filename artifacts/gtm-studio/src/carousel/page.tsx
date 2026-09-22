import Editor from "@/carousel/components/editor";
import { DocumentProvider } from "@/carousel/lib/providers/document-provider";
import { SiteFooter } from "@/carousel/components/site-footer";
import { Toaster } from "@/carousel/components/ui/toaster";

export function CarouselGeneratorPage() {
  return (
    <div className="carousel-studio flex min-h-[calc(100vh-3.5rem)] flex-col bg-card">
      <DocumentProvider>
        <Editor />
      </DocumentProvider>
      <SiteFooter />
      <Toaster />
    </div>
  );
}
