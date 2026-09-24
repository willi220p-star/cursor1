import Editor from "@/carousel/components/editor";
import { DocumentProvider } from "@/carousel/lib/providers/document-provider";
import { SiteFooter } from "@/carousel/components/site-footer";
import { Toaster } from "@/carousel/components/ui/toaster";

export function CarouselGeneratorPage({ userId }: { userId?: string }) {
  return (
    <div className="carousel-studio flex min-h-[calc(100vh-4rem)] flex-col bg-card">
      <DocumentProvider>
        <Editor userId={userId} />
      </DocumentProvider>
      <SiteFooter />
      <Toaster />
    </div>
  );
}
