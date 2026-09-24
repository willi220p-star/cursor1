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
import { usePagerContext } from "@/carousel/lib/providers/pager-context";
import { Separator } from "@/carousel/components/ui/separator";
import { FontsForm } from "@/carousel/components/forms/fonts-form";
import { PageNumberForm } from "./forms/page-number-form";
import { ScrollArea } from "@radix-ui/react-scroll-area";
import {
  Briefcase,
  Brush,
  FileDigit,
  LucideIcon,
  MessageSquare,
  Palette,
  Plus,
  Type,
} from "lucide-react";
import { CarouselCopyTemplates } from "@/carousel/components/copy-templates";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs";
import { Drawer } from "vaul";
import { DrawerContent, DrawerTrigger } from "@/carousel/components/drawer";
import { ReactNode, useEffect, useState } from "react";
import { buttonVariants } from "./ui/button";
import { ScrollBar } from "./ui/scroll-area";
import { useSelectionContext } from "@/carousel/lib/providers/selection-context";
import { useFieldsFileImporter } from "@/carousel/lib/hooks/use-fields-file-importer";
import { StyleMenu } from "@/carousel/components/style-menu";
import { useFormContext } from "react-hook-form";
import { DocumentFormReturn } from "@/carousel/lib/document-form-types";

type TabInfo = {
  name: string;
  value: string;
  icon: LucideIcon;
};

const ALL_FORMS: Record<string, TabInfo> = {
  copy: {
    name: "Copy",
    value: "copy",
    icon: MessageSquare,
  },
  brand: {
    name: "Brand",
    value: "brand",
    icon: Briefcase,
  },
  theme: {
    name: "Theme",
    value: "theme",
    icon: Palette,
  },
  fonts: {
    name: "Fonts",
    value: "fonts",
    icon: Type,
  },
  pageNumber: {
    name: "Numbers",
    value: "number",
    icon: FileDigit,
  },
};

export function SidebarPanel({ className, userId }: { className?: string; userId?: string }) {
  const form: DocumentFormReturn = useFormContext();
  const { currentSelection } = useSelectionContext();
  const [formsOpen, setFormsOpen] = useState(false);

  return (
    <div className={cn("h-full flex flex-1", className)}>
      <aside className="top-14 z-30 hidden h-full w-full shrink-0 md:sticky md:block border-r">
        <SidebarTabsPanel userId={userId} />
      </aside>
      <div className="block md:hidden h-0">
        <Drawer.Root modal={true} open={formsOpen} onOpenChange={setFormsOpen}>
          <DrawerTrigger>
            <CircularFloatingButton className="bottom-28 left-4">
              <Plus className="w-4 h-4" />
            </CircularFloatingButton>
          </DrawerTrigger>
          <DrawerContent className="h-[60%] ">
            {formsOpen ? <DrawerFormsPanel className="mt-8" userId={userId} /> : null}
          </DrawerContent>
        </Drawer.Root>
      </div>
      <div className="block md:hidden h-0">
        <Drawer.Root modal={true}>
          <DrawerTrigger>
            {currentSelection ? (
              <CircularFloatingButton className="bottom-28 right-4">
                <Brush className="w-4 h-4" />
              </CircularFloatingButton>
            ) : null}
          </DrawerTrigger>
          <DrawerContent className="h-[40%] ">
            <StyleMenu form={form} className={"m-4"} />
          </DrawerContent>
        </Drawer.Root>
      </div>
    </div>
  );
}

function VerticalTabTriggerButton({ tabInfo }: { tabInfo: TabInfo }) {
  const { setCurrentSelection } = useSelectionContext();
  //  TODO Convert this comp into a forwardref like its child
  return (
    <VerticalTabsTrigger
      value={tabInfo.value}
      className="h-16 flex flex-col gap-2 items-center py-2 justify-center"
      onFocus={() => setCurrentSelection("", null)}
    >
      <tabInfo.icon className="h-4 w-4" />
      <span className="sr-only ">{tabInfo.name}</span>
      <p className="text-xs">{tabInfo.name}</p>
    </VerticalTabsTrigger>
  );
}

function HorizontalTabTriggerButton({ tabInfo }: { tabInfo: TabInfo }) {
  const { setCurrentSelection } = useSelectionContext();
  //  TODO Convert this comp into a forwardref like its child
  return (
    <TabsTrigger
      value={tabInfo.value}
      className="h-16 flex flex-col gap-2 items-center py-2 justify-center"
      onFocus={() => setCurrentSelection("", null)}
    >
      <tabInfo.icon className="h-4 w-4" />
      <span className="sr-only ">{tabInfo.name}</span>
      <p className="text-xs">{tabInfo.name}</p>
    </TabsTrigger>
  );
}

export function SidebarTabsPanel({ userId }: { userId?: string }) {
  const { currentSelection } = useSelectionContext();
  const [tab, setTab] = useState(ALL_FORMS.brand.value);
  const form: DocumentFormReturn = useFormContext();

  return (
    <VerticalTabs
      value={currentSelection ? "" : tab}
      onValueChange={(val) => {
        if (val) {
          // Don't lost previous state when showing current selection
          setTab(val);
        }
      }}
      className="flex-1 h-full p-0"
    >
      <div className="flex flex-row h-full w-full">
        <ScrollArea className="border-r h-full bg-muted">
          <VerticalTabsList className="grid grid-cols-1 gap-2 w-20 rounded-none">
            <VerticalTabTriggerButton tabInfo={ALL_FORMS.copy} />
            <VerticalTabTriggerButton tabInfo={ALL_FORMS.brand} />
            <VerticalTabTriggerButton tabInfo={ALL_FORMS.theme} />
            <VerticalTabTriggerButton tabInfo={ALL_FORMS.fonts} />
            <VerticalTabTriggerButton tabInfo={ALL_FORMS.pageNumber} />
          </VerticalTabsList>
        </ScrollArea>
        <div className="p-2 flex min-h-0 flex-1 flex-col items-stretch w-full overflow-y-auto">
          {/* //TODO: Share this area with stylemenu */}
          {currentSelection ? (
            <StyleMenu form={form} className={"m-4"} />
          ) : // TODO: Create consistent styles between tabs and StyleMenu
          null}
          <VerticalTabsContent
            value={ALL_FORMS.copy.value}
            className="mt-0 border-0 p-0 m-4"
          >
            <h4 className="text-xl font-semibold">{ALL_FORMS.copy.name}</h4>
            <Separator className="mt-2 mb-4"></Separator>
            <CarouselCopyTemplates userId={userId} />
          </VerticalTabsContent>
          <VerticalTabsContent
            value={ALL_FORMS.brand.value}
            className="mt-0 border-0 p-0 m-4"
          >
            <h4 className="text-xl font-semibold">{ALL_FORMS.brand.name}</h4>
            <Separator className="mt-2 mb-4"></Separator>
            <BrandForm />
          </VerticalTabsContent>
          <VerticalTabsContent
            value={ALL_FORMS.theme.value}
            className="mt-0 border-0 p-0 m-4"
          >
            <h4 className="text-xl font-semibold">{ALL_FORMS.theme.name}</h4>
            <Separator className="mt-2 mb-4"></Separator>
            <ThemeForm />
          </VerticalTabsContent>
          <VerticalTabsContent
            value={ALL_FORMS.fonts.value}
            className="mt-0 border-0 p-0 m-4"
          >
            <h4 className="text-xl font-semibold">{ALL_FORMS.fonts.name}</h4>
            <Separator className="mt-2 mb-4"></Separator>
            <FontsForm />
          </VerticalTabsContent>
          <VerticalTabsContent
            value={ALL_FORMS.pageNumber.value}
            className="mt-0 border-0 p-0 m-4"
          >
            <h4 className="text-xl font-semibold">
              {ALL_FORMS.pageNumber.name}
            </h4>
            <Separator className="mt-2 mb-4"></Separator>
            <PageNumberForm />
          </VerticalTabsContent>
        </div>
      </div>
    </VerticalTabs>
  );
}

export function DrawerFormsPanel({ className, userId }: { className: string; userId?: string }) {
  const { currentSelection } = useSelectionContext();
  const [tab, setTab] = useState(ALL_FORMS.brand.value);
  // TODO: Lift state to not loose it when drawer gets closed ?

  return (
    <Tabs
      value={currentSelection ? "" : tab}
      onValueChange={(val) => {
        if (val) {
          // Don't lost previous state when showing current selection
          setTab(val);
        }
      }}
      className={cn("flex-1 w-full", className)}
    >
      <div className="flex flex-col h-full ">
        <ScrollArea className=" border-b h-full bg-muted">
          <TabsList className="grid grid-cols-5 gap-2 h-20 rounded-none">
            <HorizontalTabTriggerButton tabInfo={ALL_FORMS.copy} />
            <HorizontalTabTriggerButton tabInfo={ALL_FORMS.brand} />
            <HorizontalTabTriggerButton tabInfo={ALL_FORMS.theme} />
            <HorizontalTabTriggerButton tabInfo={ALL_FORMS.fonts} />
            <HorizontalTabTriggerButton tabInfo={ALL_FORMS.pageNumber} />
          </TabsList>
        </ScrollArea>
        <div className="p-2 w-[320px] m-auto overflow-y-auto">
          {/* // TODO Should be in a ScrollArea but it does not scroll */}
          <TabsContent
            value={ALL_FORMS.copy.value}
            className="mt-0 border-0 p-0 m-4 "
          >
            <h4 className="text-xl font-semibold">{ALL_FORMS.copy.name}</h4>
            <Separator className="mt-2 mb-4"></Separator>
            <CarouselCopyTemplates userId={userId} />
          </TabsContent>
          <TabsContent
            value={ALL_FORMS.brand.value}
            className="mt-0 border-0 p-0 m-4 "
          >
            <h4 className="text-xl font-semibold">{ALL_FORMS.brand.name}</h4>
            <Separator className="mt-2 mb-4"></Separator>
            <BrandForm />
          </TabsContent>
          <TabsContent
            value={ALL_FORMS.theme.value}
            className="mt-0 border-0 p-0 m-4 "
          >
            <h4 className="text-xl font-semibold">{ALL_FORMS.theme.name}</h4>
            <Separator className="mt-2 mb-4"></Separator>
            <ThemeForm />
          </TabsContent>
          <TabsContent
            value={ALL_FORMS.fonts.value}
            className="mt-0 border-0 p-0 m-4"
          >
            <h4 className="text-xl font-semibold">{ALL_FORMS.fonts.name}</h4>
            <Separator className="mt-2 mb-4"></Separator>
            <FontsForm />
          </TabsContent>
          <TabsContent
            value={ALL_FORMS.pageNumber.value}
            className="mt-0 border-0 p-0 m-4"
          >
            <h4 className="text-xl font-semibold">
              {ALL_FORMS.pageNumber.name}
            </h4>
            <Separator className="mt-2 mb-4"></Separator>
            <PageNumberForm />
          </TabsContent>
        </div>
      </div>
    </Tabs>
  );
}

const CircularFloatingButton = ({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) => {
  return (
    <div
      className={cn(
        buttonVariants({
          variant: "default",
          size: "icon",
        }),
        "fixed bottom-4 right-4 rounded-full w-12 h-12 ",
        className
      )}
    >
      {children}
    </div>
  );
};
