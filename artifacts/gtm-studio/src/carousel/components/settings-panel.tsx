"use client";

import { cn } from "@/carousel/lib/utils";
import { BrandForm } from "@/carousel/components/forms/brand-form";
import { ThemeForm } from "@/carousel/components/forms/theme-form";
import {
  VerticalTabs,
  VerticalTabsContent,
  VerticalTabsList,
  VerticalTabsTrigger,
} from "@/carousel/components/ui/vertical-tabs";
import { FontsForm } from "@/carousel/components/forms/fonts-form";
import { PageNumberForm } from "./forms/page-number-form";
import { Briefcase, Brush, FileDigit, LucideIcon, MessageSquare, Palette, SlidersHorizontal, Type, Users } from "lucide-react";
import { CarouselCopyTemplates } from "@/carousel/components/copy-templates";
import { PersonalisePanel } from "@/carousel/components/personalise-panel";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Drawer } from "vaul";
import { DrawerContent, DrawerTrigger } from "@/carousel/components/drawer";
import { ReactNode, useState } from "react";
import { useSelectionContext } from "@/carousel/lib/providers/selection-context";
import { StyleMenu } from "@/carousel/components/style-menu";
import { useFormContext } from "react-hook-form";
import { DocumentFormReturn } from "@/carousel/lib/document-form-types";

type TabInfo = {
  name: string;
  value: string;
  icon: LucideIcon;
  render: (userId?: string) => ReactNode;
};

const FORMS: TabInfo[] = [
  { name: "Copy", value: "copy", icon: MessageSquare, render: (userId) => <CarouselCopyTemplates userId={userId} /> },
  { name: "Personalise", value: "personalise", icon: Users, render: () => <PersonalisePanel /> },
  { name: "Brand", value: "brand", icon: Briefcase, render: () => <BrandForm /> },
  { name: "Theme", value: "theme", icon: Palette, render: () => <ThemeForm /> },
  { name: "Fonts", value: "fonts", icon: Type, render: () => <FontsForm /> },
  { name: "Numbers", value: "number", icon: FileDigit, render: () => <PageNumberForm /> },
];

const DEFAULT_TAB = "brand";

function TabHeading({ children }: { children: ReactNode }) {
  return <h2 className="mb-4 border-b border-border pb-2 text-lg font-semibold">{children}</h2>;
}

export function SidebarPanel({ className, userId }: { className?: string; userId?: string }) {
  const form: DocumentFormReturn = useFormContext();
  const { currentSelection } = useSelectionContext();
  const [formsOpen, setFormsOpen] = useState(false);

  return (
    <>
      <aside className={cn("carousel-sidebar hidden min-h-0 border-r border-border bg-card md:block", className)}>
        <SidebarTabsPanel userId={userId} />
      </aside>
      <div className="carousel-mobile-actions md:hidden">
        <Drawer.Root modal={true} open={formsOpen} onOpenChange={setFormsOpen}>
          <DrawerTrigger asChild>
            <button type="button" className="btn btn-primary shadow-lg">
              <SlidersHorizontal size={16} aria-hidden /> Edit
            </button>
          </DrawerTrigger>
          <DrawerContent className="h-[75dvh] border-t border-border bg-card">
            {formsOpen ? <DrawerFormsPanel className="mt-8" userId={userId} /> : null}
          </DrawerContent>
        </Drawer.Root>
        {currentSelection ? (
          <Drawer.Root modal={true}>
            <DrawerTrigger asChild>
              <button type="button" className="btn btn-quiet bg-card shadow-lg">
                <Brush size={16} aria-hidden /> Style
              </button>
            </DrawerTrigger>
            <DrawerContent className="h-[50dvh] border-t border-border bg-card">
              <div className="overflow-y-auto pt-6">
                <StyleMenu form={form} className={"m-4"} />
              </div>
            </DrawerContent>
          </Drawer.Root>
        ) : null}
      </div>
    </>
  );
}

export function SidebarTabsPanel({ userId }: { userId?: string }) {
  const { currentSelection, setCurrentSelection } = useSelectionContext();
  const [tab, setTab] = useState(DEFAULT_TAB);
  const form: DocumentFormReturn = useFormContext();

  return (
    <VerticalTabs
      value={currentSelection ? "" : tab}
      onValueChange={(val) => {
        if (val) setTab(val);
      }}
      className="h-full p-0"
    >
      <div className="flex h-full w-full flex-row">
        <VerticalTabsList className="grid w-[84px] flex-none auto-rows-min grid-cols-1 gap-1 rounded-none border-r border-border bg-[var(--surface-2)] p-2">
          {FORMS.map((info) => (
            <VerticalTabsTrigger
              key={info.value}
              value={info.value}
              className="flex h-16 flex-col items-center justify-center gap-1.5 px-1 py-2 text-muted-foreground data-[state=active]:text-foreground"
              onFocus={() => setCurrentSelection("", null)}
            >
              <info.icon className="h-4 w-4" aria-hidden />
              <span className="text-xs">{info.name}</span>
            </VerticalTabsTrigger>
          ))}
        </VerticalTabsList>
        <div className="flex min-h-0 w-full min-w-0 flex-1 flex-col items-stretch overflow-y-auto p-2">
          {currentSelection ? <StyleMenu form={form} className={"m-4"} /> : null}
          {FORMS.map((info) => (
            <VerticalTabsContent key={info.value} value={info.value} className="m-4 mt-0 border-0 p-0">
              <TabHeading>{info.name}</TabHeading>
              {info.render(userId)}
            </VerticalTabsContent>
          ))}
        </div>
      </div>
    </VerticalTabs>
  );
}

export function DrawerFormsPanel({ className, userId }: { className: string; userId?: string }) {
  const [tab, setTab] = useState(DEFAULT_TAB);

  return (
    <Tabs value={tab} onValueChange={(val) => val && setTab(val)} className={cn("flex h-full w-full flex-col", className)}>
      <TabsList className="scrollbar-thin mx-4 flex h-auto flex-none justify-start gap-1 overflow-x-auto rounded-[12px] bg-[var(--fill)] p-1">
        {FORMS.map((info) => (
          <TabsTrigger key={info.value} value={info.value} className="flex min-h-11 flex-none items-center gap-1.5 px-3 text-xs">
            <info.icon className="h-4 w-4" aria-hidden />
            {info.name}
          </TabsTrigger>
        ))}
      </TabsList>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-8 pt-4">
        {FORMS.map((info) => (
          <TabsContent key={info.value} value={info.value} className="m-0 border-0 p-0">
            <TabHeading>{info.name}</TabHeading>
            {info.render(userId)}
          </TabsContent>
        ))}
      </div>
    </Tabs>
  );
}
