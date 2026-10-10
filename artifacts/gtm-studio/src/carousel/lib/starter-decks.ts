import * as z from "zod";
import { CommonSlideSchema } from "@/carousel/lib/validation/slide-schema";
import { DescriptionSchema, SubtitleSchema, TitleSchema } from "@/carousel/lib/validation/text-schema";
import { DEFAULT_BACKGROUND_IMAGE_INPUT } from "@/carousel/lib/validation/image-schema";

type Slide = z.infer<typeof CommonSlideSchema>;
type Align = "Left" | "Center" | "Right";
type Size = "Small" | "Medium" | "Large";

const title = (text: string, fontSize: Size = "Medium", align: Align = "Left") => TitleSchema.parse({ text, style: { fontSize, align } });
const subtitle = (text: string, fontSize: Size = "Medium", align: Align = "Left") => SubtitleSchema.parse({ text, style: { fontSize, align } });
const description = (text: string, fontSize: Size = "Medium", align: Align = "Left") => DescriptionSchema.parse({ text, style: { fontSize, align } });

function slide(...elements: Slide["elements"]): Slide {
  return { elements, backgroundImage: { ...DEFAULT_BACKGROUND_IMAGE_INPUT, source: { ...DEFAULT_BACKGROUND_IMAGE_INPUT.source } } };
}

export type StarterDeck = {
  id: string;
  name: string;
  description: string;
  slides: () => Slide[];
};

/** Starting points for B2B outbound carousels. Hook slides carry merge tags with safe fallbacks. */
export const STARTER_DECKS: StarterDeck[] = [
  {
    id: "hook-problem-proof-cta",
    name: "Hook → Problem → Proof → CTA",
    description: "The classic outbound arc in five slides.",
    slides: () => [
      slide(
        subtitle("For {first_name|you}"),
        title("{company|Your team} is leaving pipeline on the table", "Small"),
        description("Swipe for the 3-minute fix →"),
      ),
      slide(title("The problem"), description("Most outbound reads like it was written for everyone. Buyers can tell in one line, and they scroll past.")),
      slide(title("Why it keeps happening"), description("Lists get bigger, copy gets more generic, reply rates fall. More volume only hides the leak.")),
      slide(subtitle("Proof"), title("3.4× more replies", "Large"), description("Same list, same offer. The only change was one personal line per prospect.")),
      slide(
        title("Want the playbook for {company|your team}?"),
        description("Comment PLAYBOOK or send me a DM and I'll share the exact template."),
        subtitle("Follow for more outbound teardowns"),
      ),
    ],
  },
  {
    id: "myth-vs-fact",
    name: "Myth vs fact",
    description: "Bust three beliefs your buyers hold.",
    slides: () => [
      slide(subtitle("{first_name|Hey there}, quick reality check"), title("3 cold email myths that cost you meetings")),
      slide(subtitle("Myth #1"), title("Longer emails look more professional", "Small"), description("Fact: under 80 words gets more replies. Respect the scroll.")),
      slide(subtitle("Myth #2"), title("Follow-ups annoy people", "Small"), description("Fact: most replies arrive on touch three or four. Silence is not a no.")),
      slide(subtitle("Myth #3"), title("Personalisation doesn't scale", "Small"), description("Fact: one researched line per row beats ten generic paragraphs.")),
      slide(title("Which myth surprised you?"), description("Tell me in the comments. Save this for your next campaign.")),
    ],
  },
  {
    id: "five-lessons",
    name: "5 lessons",
    description: "A listicle that teaches and builds trust.",
    slides: () => [
      slide(subtitle("{first_name|Founders}, steal these"), title("5 lessons from 10,000 cold emails")),
      slide(subtitle("Lesson 1"), title("Lead with them, not you", "Small"), description("The first line should be about their world. Your company can wait until line three.")),
      slide(subtitle("Lesson 2"), title("One ask per email", "Small"), description("Two calls to action means zero. Pick the smallest next step.")),
      slide(subtitle("Lesson 3"), title("Timing beats copy", "Small"), description("A new hire, a funding round or a launch makes an average email land.")),
      slide(subtitle("Lesson 4"), title("Clean lists win", "Small"), description("Verify every address. Bounces quietly sink your whole domain.")),
      slide(subtitle("Lesson 5"), title("Measure replies, not opens", "Small"), description("Opens are noisy. Positive replies are the only number that pays.")),
      slide(title("Found this useful?"), description("Repost to help your network, and follow for weekly outbound breakdowns.")),
    ],
  },
  {
    id: "case-study",
    name: "Case study",
    description: "Before, approach, result. Built for social proof.",
    slides: () => [
      slide(subtitle("Made for {company|your team}"), title("How a 6-person agency booked 42 meetings in 30 days")),
      slide(subtitle("Before"), title("Busy, but no pipeline", "Small"), description("Referrals had dried up. Two hours a day on LinkedIn produced a handful of polite no's.")),
      slide(subtitle("What we changed"), title("Signal-led outbound", "Small"), description("Tight ICP, a weekly list built from hiring signals, and one personal line for every prospect.")),
      slide(subtitle("Result"), title("42 meetings, 9 new clients", "Large"), description("Reply rate went from 1.8% to 11.2% inside the first month.")),
      slide(
        title("Want the same for {company|your team}?"),
        description("Book a 15-minute teardown. I'll show you where the meetings are hiding."),
      ),
    ],
  },
];
