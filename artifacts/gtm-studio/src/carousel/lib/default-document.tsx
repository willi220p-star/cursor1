import * as z from "zod";
import { MultiSlideSchema } from "@/carousel/lib/validation/slide-schema";
import { SlideType } from "@/carousel/lib/validation/slide-schema";

import { getDefaultSlideOfType } from "@/carousel/lib/default-slides";
import { DEFAULT_IMAGE_INPUT } from "@/carousel/lib/validation/image-schema";

const defaultSlideValues: z.infer<typeof MultiSlideSchema> = [
  getDefaultSlideOfType(SlideType.enum.Intro),
  getDefaultSlideOfType(SlideType.enum.Common),
  getDefaultSlideOfType(SlideType.enum.Content),
  getDefaultSlideOfType(SlideType.enum.Content),
  getDefaultSlideOfType(SlideType.enum.Outro),
];

export const defaultValues = {
  slides: defaultSlideValues,
  config: {
    brand: {
      avatar: DEFAULT_IMAGE_INPUT,

      name: "My name",
      handle: "@name",
    },
    theme: {
      isCustom: false,
      pallette: "black",
      primary: "#0d0d0d",
      secondary: "#161616",
      background: "#ffffff",
    },
    fonts: {
      font1: "DM_Serif_Display",
      font2: "DM_Sans",
    },
    pageNumber: {
      showNumbers: true,
    },
  },
  filename: "My Carousel File",
};
