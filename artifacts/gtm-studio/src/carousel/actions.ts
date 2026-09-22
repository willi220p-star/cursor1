import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import {
  MultiSlideSchema,
  UnstyledMultiSlideSchema,
} from "@/carousel/lib/validation/slide-schema";
import { UnstyledDocumentSchema } from "@/carousel/lib/validation/document-schema";
import {
  UnstyledDescriptionSchema,
  UnstyledSubtitleSchema,
  UnstyledTitleSchema,
} from "@/carousel/lib/validation/text-schema";

const carouselFunctionSchema = {
  name: "carouselCreator",
  description: "Creates a carousel with multiple slides for a given topic.",
  parameters: zodToJsonSchema(UnstyledDocumentSchema, {
    definitions: {
      UnstyledTitleSchema,
      UnstyledSubtitleSchema,
      UnstyledDescriptionSchema,
    },
  }),
};

export async function generateCarouselSlidesAction(userPrompt: string, apiKey?: string) {
  const key = apiKey?.trim();
  if (!key) return null;
  const generatedSlides = await generateCarouselSlides(userPrompt, key);
  return generatedSlides;
}

export async function generateCarouselSlides(
  topicPrompt: string,
  apiKey: string,
): Promise<z.infer<typeof MultiSlideSchema> | null> {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      temperature: 0,
      messages: [
        {
          role: "system",
          content: `
      Create a Carousel of slides following these rules

      Arguments Schema Instructions:
       - Respect the argument schema and only use the allowed values for element type, which are 'Title', 'Subtitle' and 'Description'.
       - Each slide can use the multiple elements and they can be of different type or not.
       - Respect the 'maxLength' value which is the maximum number of characters in a given field. Write less than 70% of that number.

      Guidelines:
       - Create 8-15 slides.
       - Each slide has 2-3 different elements. E.g. [Title, Description], or [Title, Subtitle], or [Subtitle, Description].
       - Each slide All the elements in that slide are about that idea.
       - Adapt, reorganize and rephrase the content to fit the slides format.
       - Add Emojis to the text in Title, Subtitle and Description.
       - Don't add slide numbers.
       - Description element text should be short.
       `,
        },
        { role: "user", content: topicPrompt },
      ],
      tools: [
        {
          type: "function",
          function: carouselFunctionSchema,
        },
      ],
      tool_choice: { type: "function", function: { name: "carouselCreator" } },
    }),
  });
  if (!response.ok) {
    console.error("OpenAI carousel request failed", await response.text());
    return null;
  }
  const payload = await response.json();
  const raw =
    payload?.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments
    || payload?.choices?.[0]?.message?.function_call?.arguments
    || "";
  let jsonParsed: unknown = null;
  try {
    jsonParsed = JSON.parse(raw || "{}");
  } catch {
    return null;
  }
  const unstyledDocumentParseResult = UnstyledDocumentSchema.safeParse(jsonParsed);
  if (unstyledDocumentParseResult.success) {
    return MultiSlideSchema.parse(unstyledDocumentParseResult.data.slides);
  }
  console.error(unstyledDocumentParseResult.error, jsonParsed);
  return null;
}

void UnstyledMultiSlideSchema;
