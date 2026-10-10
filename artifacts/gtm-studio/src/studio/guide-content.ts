/**
 * "How it works" guide content, one entry per studio plus the Desk.
 * Edit the text here; components/studio/guide-sheet.tsx renders it.
 *
 * `labels` lists the exact UI text an item points at (button names, section titles, column suffixes).
 * guide-content.test.ts checks each one still appears in that studio's source files, so a renamed button
 * fails the test instead of leaving the guide pointing at something that no longer exists.
 */
import type { StudioKey } from './studios';

export type GuideKey = StudioKey | 'desk';

export type GuideItem = {
  title: string;
  body: string;
  labels?: string[];
};

export type GuideEntry = {
  /** Sheet heading, e.g. "How Notes works". */
  heading: string;
  intro: string;
  steps: GuideItem[];
  tips: GuideItem[];
};

export type WhatsNewItem = {
  text: string;
  /** Which guides show this entry. */
  keys: GuideKey[];
};

/** Bump when the What's new list changes; the "?" button shows a dot until the guide is opened once. */
export const GUIDE_RELEASE = '2026-10-10';
export const GUIDE_SEEN_KEY = 'gtm-studio-guide-seen';

const listStudios: GuideKey[] = ['handwritten', 'handgif', 'avatar', 'memes', 'gif'];
const paperStudios: GuideKey[] = ['handwritten', 'handgif', 'avatar'];

export const guideContent: Record<GuideKey, GuideEntry> = {
  handwritten: {
    heading: 'How Notes works',
    intro: 'One handwritten note per prospect row, ready to drop into a sequence as an image.',
    steps: [
      {
        title: 'Import your list',
        body: 'Press Import (or the I key) and add a CSV or spreadsheet. Each row becomes one note, and every column can be used as a merge tag.',
        labels: ['Import'],
      },
      {
        title: 'Write the note in Copy',
        body: 'Type the Message or start from the Opener library. Merge tags like {first_name|there} fill from each row; the text after | is used when a cell is blank. The word counter beside Message tells you when a note is getting too long to read on a phone.',
        labels: ['Copy', 'Message', 'Opener library', ' words'],
      },
      {
        title: 'Add a personal hook',
        body: 'Put {hook} where the personal line goes and pick its column under Personal hook. The pen marks it with an Underline or a Circle on every note.',
        labels: ['Personal hook', 'Underline', 'Circle'],
      },
      {
        title: 'Pick the look',
        body: 'In Look, Made for sets the canvas, framing and writing size in one click: Desktop email, Phone-first or LinkedIn DM. Choose a Writing style and a Paper and ink finish such as Phone photo. Auto-size writing (under More settings) grows short notes to fill the card and shrinks long ones to fit.',
        labels: ['Look', 'Made for', 'Desktop email', 'Phone-first', 'LinkedIn DM', 'Writing style', 'Paper and ink finish', 'Phone photo', 'Auto-size writing', 'More settings'],
      },
      {
        title: 'Check it at inbox size',
        body: 'In Ship, open Inbox preview to see this row the size it shows in an email or DM. Under File type, Email JPG is about 150 KB; Full PNG is lossless and often over 1 MB.',
        labels: ['Ship', 'Inbox preview', 'File type', 'Email JPG', 'Full PNG'],
      },
      {
        title: 'Generate and take the CSV',
        body: 'Generate makes every row, uploads the files and writes the links back onto your list. Download list CSV, or All as ZIP, and import the CSV into Smartlead.',
        labels: ['Generate', 'Download list CSV', 'All as ZIP'],
      },
    ],
    tips: [
      {
        title: 'Keep step 1 plain text',
        body: 'An image plus a link in the first cold email is a common spam trigger. Send the note in step 2 or 3, or on LinkedIn.',
        labels: ['Keep step 1 plain text'],
      },
      {
        title: 'Phone-first is the safe default',
        body: 'Most replies come from a phone. Phone-first keeps the writing big and the note around 25 words.',
        labels: ['Phone-first'],
      },
      {
        title: 'Set the alt text',
        body: 'Use the handwritten_alt column as the image alt text in Smartlead, so a blocked image still says something.',
        labels: ['_alt'],
      },
      {
        title: 'Test two messages',
        body: 'Tick Variant B (A/B test the message). Odd rows get A, even rows get B, and the CSV carries the variant so Smartlead can split reply rates.',
        labels: ['Variant B (A/B test the message)'],
      },
      {
        title: 'Try a Plain card',
        body: 'Under More settings, Page has a Plain card option: thick cream stock with no lines, which reads cleaner on a small screen.',
        labels: ['Page', 'Plain card'],
      },
    ],
  },
  handgif: {
    heading: 'How Handwriting GIF works',
    intro: 'A photographed hand writes each prospect’s note while they watch.',
    steps: [
      {
        title: 'Import your list',
        body: 'Press Import and add a CSV or spreadsheet. Each row becomes one GIF.',
        labels: ['Import'],
      },
      {
        title: 'Write a short note',
        body: 'In Copy, write the Message or pick one from the Opener library. Short notes write faster and keep the file small. Add {hook} and a Personal hook column for the line the pen marks.',
        labels: ['Copy', 'Message', 'Opener library', 'Personal hook'],
      },
      {
        title: 'Pick the hand and speed',
        body: 'In Look, choose Made for, then under Writing GIF pick a hand and a Writing speed. Leave Keep under 1 MB ticked.',
        labels: ['Look', 'Made for', 'Writing GIF', 'Writing speed', 'Keep under 1 MB'],
      },
      {
        title: 'Check it at inbox size',
        body: 'In Ship, Inbox preview shows the row in email and DM mockups before you run the batch.',
        labels: ['Ship', 'Inbox preview'],
      },
      {
        title: 'Generate and take the CSV',
        body: 'Generate makes every GIF plus a still JPG of the finished note, uploads both and writes the links onto your list. Download list CSV for Smartlead.',
        labels: ['Generate', 'Download list CSV'],
      },
    ],
    tips: [
      {
        title: 'Outlook shows the first frame',
        body: 'Desktop Outlook only shows a GIF’s first frame, so each GIF opens on the finished note before it plays. Nobody sees a blank page.',
      },
      {
        title: 'Use the still where GIFs are blocked',
        body: 'The handwriting_gif_still_url column links a JPG of the finished note. Use it for clients or tools that block GIFs.',
        labels: ['_still_url'],
      },
      {
        title: 'Stay under 1 MB',
        body: 'Large images hurt deliverability and load slowly on mobile data. Keep under 1 MB lowers the GIF quality until each file fits.',
        labels: ['Keep under 1 MB'],
      },
      {
        title: 'Save it for a follow-up',
        body: 'A moving note works well as the bump after a plain-text first email, when the prospect already knows your name.',
      },
    ],
  },
  avatar: {
    heading: 'How Avatar works',
    intro: 'A portrait card with a typed letter, still or typing itself out.',
    steps: [
      {
        title: 'Import a list with portraits',
        body: 'Press Import and add your list. In Copy, pick the Portrait column and, if you have one, a Message column for each row’s personal line.',
        labels: ['Import', 'Portrait column', 'Message column'],
      },
      {
        title: 'Write the letter',
        body: 'In Copy, write the Letter copy or start from the Opener library. Merge tags fill from each row.',
        labels: ['Copy', 'Letter copy', 'Opener library'],
      },
      {
        title: 'Pick the layout',
        body: 'In Look, Made for sets the card: Desktop email puts the portrait beside the letter; Phone-first and LinkedIn DM stack it on top so the type stays big. Portrait position switches between On top and Left.',
        labels: ['Look', 'Made for', 'Desktop email', 'Phone-first', 'LinkedIn DM', 'Portrait position', 'On top', 'Left'],
      },
      {
        title: 'Still or moving',
        body: 'Letter motion None exports a still card; Auto writing types the letter in and exports a GIF.',
        labels: ['Letter motion', 'None', 'Auto writing'],
      },
      {
        title: 'Check, then generate',
        body: 'In Ship, open Inbox preview, pick the File type for still cards, then Generate. Download list CSV for Smartlead.',
        labels: ['Ship', 'Inbox preview', 'File type', 'Generate', 'Download list CSV'],
      },
    ],
    tips: [
      {
        title: 'Read the cards that need a look',
        body: 'Under Copy, a list shows which cards need a look because the letter would be cut off. Shorten the letter or switch to a preset with more room.',
        labels: ['cards need'],
      },
      {
        title: 'No wrong faces',
        body: 'A row with no portrait gets the company’s site icon, or the prospect’s initials on a colour picked from their company. It never borrows another row’s photo.',
      },
      {
        title: 'The letter fits itself',
        body: 'The type shrinks to fit the text frame, so a long row stays inside the card. Keep it near 30 words on Phone-first so it stays readable.',
      },
      {
        title: 'Still cards are lighter',
        body: 'A still JPG loads faster than a GIF. Use Auto writing for a warm follow-up, not for a cold first touch.',
        labels: ['Auto writing'],
      },
    ],
  },
  memes: {
    heading: 'How Memes works',
    intro: 'A moving meme on a real photo, with each prospect’s name in the caption.',
    steps: [
      {
        title: 'Import your list',
        body: 'Press Import and add a CSV or spreadsheet. Each row becomes one meme.',
        labels: ['Import'],
      },
      {
        title: 'Pick a template',
        body: 'Choose from the Templates strip under the stage. They are real, copyright-safe photos. Press Add live GIF to bring your own.',
        labels: ['Templates', 'Add live GIF'],
      },
      {
        title: 'Write the captions',
        body: 'In Copy, edit each of the Text layers. Merge tags like {first_name|THERE} fill from each row, and captions shrink to fit so long names stay on the image.',
        labels: ['Copy', 'Text layers'],
      },
      {
        title: 'Set the motion',
        body: 'In Look, Motion picks how the meme moves. A moving meme exports as a GIF, a still frame as a PNG.',
        labels: ['Look', 'Motion'],
      },
      {
        title: 'Generate and take the CSV',
        body: 'In Ship, check Inbox preview, then Generate. Download list CSV, or All as ZIP, for Smartlead.',
        labels: ['Ship', 'Inbox preview', 'Generate', 'Download list CSV', 'All as ZIP'],
      },
    ],
    tips: [
      {
        title: 'Memes are for follow-ups',
        body: 'A meme lands best as a bump or breakup email to someone who has not replied, not as the first message.',
      },
      {
        title: 'Keep captions short',
        body: 'Under eight words reads at a glance on a phone. Check the rows with the longest names and companies in the filmstrip.',
      },
      {
        title: 'Set the alt text',
        body: 'Use the meme_alt column as the image alt text so a blocked image still says something.',
        labels: ['_alt'],
      },
    ],
  },
  gif: {
    heading: 'How GIFs works',
    intro: 'Your own GIF or image with styled, moving text for each prospect.',
    steps: [
      {
        title: 'Import your list',
        body: 'Press Import and add a CSV or spreadsheet. Each row becomes one GIF.',
        labels: ['Import'],
      },
      {
        title: 'Pick a background',
        body: 'Choose from the Templates strip, or press Add live GIF to use your own GIF or image.',
        labels: ['Templates', 'Add live GIF'],
      },
      {
        title: 'Write the text',
        body: 'In Copy, edit the Text layers. Each layer has its own Text motion, and captions shrink to fit long names.',
        labels: ['Copy', 'Text layers', 'Text motion'],
      },
      {
        title: 'Tune the file',
        body: 'Under More settings, GIF encoding sets Frame rate, Loop and Quality. Leave Keep under 1 MB ticked.',
        labels: ['More settings', 'GIF encoding', 'Frame rate', 'Loop', 'Quality', 'Keep under 1 MB'],
      },
      {
        title: 'Generate and take the CSV',
        body: 'In Ship, Generate makes every GIF plus a still JPG, and Download list CSV gives you the links for Smartlead.',
        labels: ['Ship', 'Generate', 'Download list CSV'],
      },
    ],
    tips: [
      {
        title: 'Outlook shows the first frame',
        body: 'Each GIF opens on its finished frame, so desktop Outlook, which only shows the first frame, still shows the whole message.',
      },
      {
        title: 'Use the still where GIFs are blocked',
        body: 'The gif_still_url column links a JPG of the finished frame.',
        labels: ['_still_url'],
      },
      {
        title: 'Fewer frames, smaller file',
        body: 'A lower Frame rate and a short loop keep the GIF light on mobile data.',
        labels: ['Frame rate'],
      },
    ],
  },
  carousel: {
    heading: 'How Carousel works',
    intro: 'LinkedIn carousels, exported as a PDF or slide images, and personalised per contact if you want.',
    steps: [
      {
        title: 'Start from a layout',
        body: 'Open Library and pick one of the Starter layouts, or open a Saved carousel. Layouts keep your brand, theme and fonts.',
        labels: ['Library', 'Starter layouts', 'Saved'],
      },
      {
        title: 'Write the slides',
        body: 'Edit each slide on the canvas. Set Brand, Theme and Fonts in the side panel.',
        labels: ['Brand', 'Theme', 'Fonts'],
      },
      {
        title: 'Pick the page size',
        body: 'Choose 4:5 (1080 × 1350) or 1:1 (1080 × 1080) in the toolbar. Exports are always 1080 wide, the size LinkedIn shows.',
        labels: ['4:5', '1:1', '1080 × 1350', '1080 × 1080'],
      },
      {
        title: 'Save and export',
        body: 'Press Save, then Download PDF for a document post or Slide images for single images.',
        labels: ['Save', 'Download PDF', 'Slide images'],
      },
      {
        title: 'Personalise for a list',
        body: 'In Personalise, add merge tags like {first_name|there} to any slide, then Import a contact list and download a ZIP of one PDF per contact.',
        labels: ['Personalise', 'Import a contact list', 'ZIP of'],
      },
    ],
    tips: [
      {
        title: 'Hook on slide one',
        body: 'Only the first slide shows in the feed. Put the claim or question there, not your logo.',
      },
      {
        title: 'Big type reads on phones',
        body: 'The editor is 400 px wide and exports scale up to 1080, so text that looks large in the editor is right on a phone.',
      },
      {
        title: 'A personal carousel opens doors',
        body: 'For top accounts, send a personalised PDF in a LinkedIn DM after you connect. Always give merge tags a fallback after the |.',
      },
    ],
  },
  desk: {
    heading: 'How the Desk works',
    intro: 'Your starting point: pick a studio, pick up a campaign, and keep the library tidy.',
    steps: [
      {
        title: 'Pick a studio',
        body: 'Choose a tile under Studios, or Continue the campaign you worked on last.',
        labels: ['Studios', 'Continue'],
      },
      {
        title: 'Find a campaign',
        body: 'Use Search the library, filter by kind, or pick a client from All clients.',
        labels: ['Search the library', 'All clients'],
      },
      {
        title: 'Read its status',
        body: 'Each campaign shows a status pill. Open the three dots and choose History to see when it was generated and exported.',
        labels: ['History'],
      },
      {
        title: 'Organise',
        body: 'From the three dots: Duplicate a campaign, Set client…, Rename it or Delete it. A delete can be undone from the message that appears.',
        labels: ['Duplicate', 'Set client…', 'Rename', 'Delete', 'Undo'],
      },
    ],
    tips: [
      {
        title: 'Tag every campaign with a client',
        body: 'With a client set, the filter shows one client’s work at a time, which keeps a shared library usable.',
        labels: ['Set client'],
      },
      {
        title: 'Duplicate what worked',
        body: 'Start the next list from a campaign that got replies instead of a blank one. The look and copy come with it.',
        labels: ['Duplicate'],
      },
      {
        title: 'Only changed rows are redone',
        body: 'When you Generate again, Regenerate changed rows only keeps the files and links for rows you did not touch.',
        labels: ['Regenerate changed rows only'],
      },
    ],
  },
};

export const whatsNew: WhatsNewItem[] = [
  { text: 'Big lists run in 400-row chunks', keys: listStudios },
  { text: 'Generate again redoes only the rows that changed', keys: [...listStudios, 'desk'] },
  { text: 'Clean up old versions from a campaign’s menu', keys: ['desk'] },
  { text: 'Set a client on a campaign and filter the library by client', keys: ['desk'] },
  { text: 'Undo a delete, and see each campaign’s status and history', keys: ['desk'] },
  { text: 'Made for presets: Desktop email, Phone-first and LinkedIn DM', keys: paperStudios },
  { text: 'Opener library and Variant B for A/B tests', keys: paperStudios },
  { text: 'Inbox preview shows each row at real inbox size', keys: listStudios },
  { text: 'Personal hook marked with an underline or a circle', keys: ['handwritten', 'handgif'] },
  { text: 'Phone photo finish and a plain card page', keys: ['handwritten'] },
  { text: 'Alt text column for every image', keys: ['handwritten', 'avatar', 'memes', 'gif'] },
  { text: 'GIFs open on the finished frame and come with a still JPG', keys: ['handgif', 'avatar', 'gif'] },
  { text: 'Keep under 1 MB for GIFs', keys: ['handgif', 'avatar', 'gif'] },
  { text: 'Portrait on top, and initials or a logo when a row has no photo', keys: ['avatar'] },
  { text: 'Captions shrink to fit long names', keys: ['memes', 'gif'] },
  { text: 'Starter layouts, slide images and a ZIP of personalised PDFs', keys: ['carousel'] },
];

export function whatsNewFor(key: GuideKey) {
  return whatsNew.filter((item) => item.keys.includes(key));
}
