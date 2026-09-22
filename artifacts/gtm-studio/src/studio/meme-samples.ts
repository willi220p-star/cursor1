import { publicAssetUrl } from '@/lib/utils';
import type { MemeEffect, MemeMotion, PhotoMotion, TextLayer } from './types';

export type MemeSample = {
  id: string;
  name: string;
  blurb: string;
  src: string;
  animation: MemeMotion;
  photoMotion?: PhotoMotion;
  effect?: MemeEffect;
  live?: boolean;
  layers: TextLayer[];
};

const layer = (
  id: string,
  name: string,
  text: string,
  x: number,
  y: number,
  width: number,
  height: number,
  fontSize: number,
  extras: Partial<TextLayer> = {},
): TextLayer => ({
  id,
  name,
  text,
  x,
  y,
  width,
  height,
  fontSize,
  align: 'center',
  color: '#ffffff',
  outline: true,
  animation: 'still',
  highlight: '',
  highlightColor: '#ffe566',
  ...extras,
});

const topBottom = (top: string, bottom: string): TextLayer[] => [
  layer('headline', 'Top line', top, 0.06, 0.06, 0.88, 0.2, 72),
  layer('footer', 'Bottom line', bottom, 0.06, 0.74, 0.88, 0.2, 52),
];

const stacked = (lines: string[]): TextLayer[] =>
  lines.map((text, index) => layer(
    `tier-${index}`,
    `Tier ${index + 1}`,
    text,
    0.08,
    0.06 + index * (0.88 / Math.max(1, lines.length)),
    0.84,
    0.2,
    34,
  ));

/**
 * Original photographs in the familiar ad layouts from
 * https://shlomo-genchin.notion.site/50-Copyright-Safe-Meme-Templates-66a71bb3274a42bda72859dfa2be8a5f
 * — no copyrighted characters or celebrity stills.
 */
export const memeSamples: MemeSample[] = [
  {
    id: 'two-buttons',
    name: 'Two buttons',
    blurb: 'Bounce — pick a path',
    src: publicAssetUrl('/samples/two-buttons.png'),
    animation: 'bounce',
    layers: topBottom('{first_name|THERE} HAS TWO BUTTONS', 'Keep the old sequence, or try {company} this week.'),
  },
  {
    id: 'distracted',
    name: 'Looking away',
    blurb: 'Slide — the glance walks off',
    src: publicAssetUrl('/samples/distracted.png'),
    animation: 'slide',
    layers: topBottom('THE OLD SEQUENCE', '{first_name|there} looking at a better note for {company}.'),
  },
  {
    id: 'table-sign',
    name: 'Table sign',
    blurb: 'Wobble — the board tilts',
    src: publicAssetUrl('/samples/table-sign.png'),
    animation: 'wobble',
    layers: topBottom('CHANGE MY MIND, {first_name|THERE}', '{company} can start conversations this way.'),
  },
  {
    id: 'stressed-laptop',
    name: 'Stressed laptop',
    blurb: 'Shake — the tabs jolt',
    src: publicAssetUrl('/samples/stressed-laptop.png'),
    animation: 'shake',
    layers: topBottom('THIS IS FINE', '{company} still sending the same cold email.'),
  },
  {
    id: 'celebration',
    name: 'Desk win',
    blurb: 'Pop — the win snaps in',
    src: publicAssetUrl('/samples/celebration.png'),
    animation: 'pop',
    layers: topBottom('HEY {first_name|THERE}', 'One idea that could help {company} this week.'),
  },
  {
    id: 'pointing-board',
    name: 'Pointing at the board',
    blurb: 'Pulse — the pitch breathes',
    src: publicAssetUrl('/samples/pointing-board.png'),
    animation: 'pulse',
    layers: topBottom('WAIT {first_name|THERE}', 'What if {company} started conversations this way?'),
  },
  {
    id: 'coffee-cups',
    name: 'Coffee catch-up',
    blurb: 'Zoom — the cups push in',
    src: publicAssetUrl('/samples/coffee-cups.png'),
    animation: 'zoom',
    photoMotion: 'zoom',
    layers: topBottom('WORTH 15 MIN, {first_name|THERE}?', 'I have one idea for {company}.'),
  },
  {
    id: 'empty-boardroom',
    name: 'Empty boardroom',
    blurb: 'Fade — the room appears',
    src: publicAssetUrl('/samples/empty-boardroom.png'),
    animation: 'fade',
    layers: topBottom('THIS MEETING COULD HAVE BEEN A NOTE', '{company} in {city|your market}.'),
  },
  {
    id: 'handshake',
    name: 'Deal closed',
    blurb: 'Rise — the handshake lifts',
    src: publicAssetUrl('/samples/handshake.png'),
    animation: 'rise',
    photoMotion: 'rise',
    layers: topBottom('WE SHOULD TALK, {first_name|THERE}', 'I have one idea for {company}.'),
  },
  {
    id: 'before-after',
    name: 'Before / after',
    blurb: 'Flip — two states',
    src: publicAssetUrl('/samples/before-after.png'),
    animation: 'flip',
    layers: topBottom('LEFT: OLD OUTBOUND', 'Right: a note {company} will actually open.'),
  },
  {
    id: 'waiting',
    name: 'Still waiting',
    blurb: 'Drift — time floats',
    src: publicAssetUrl('/samples/waiting.png'),
    animation: 'drift',
    photoMotion: 'drift',
    layers: topBottom('{first_name|THERE} IS STILL WAITING', 'The {company} sequence did not land.'),
  },
  {
    id: 'skyline',
    name: 'Skyline flex',
    blurb: 'Fade — appears out of the skyline',
    src: publicAssetUrl('/samples/skyline.png'),
    animation: 'fade',
    layers: topBottom('{company} LOOKS THIS BIG', 'The pipeline in {city|your market} does not have to.'),
  },
  {
    id: 'team',
    name: 'Team huddle',
    blurb: 'Pop — the crew snaps in',
    src: publicAssetUrl('/samples/team.png'),
    animation: 'pop',
    layers: topBottom('{role|LEADERS} AT {company}', 'Stop sending the same templated note.'),
  },
  {
    id: 'night-desk',
    name: 'Night desk',
    blurb: 'Live rise — lamp and heat',
    src: publicAssetUrl('/samples/night-desk.png'),
    animation: 'rise',
    photoMotion: 'rise',
    effect: 'fire',
    layers: topBottom('WHILE {company} SLEEPS', '{first_name|there}, this image already has your name on it.'),
  },
  {
    id: 'expanding-boxes',
    name: 'Expanding boxes',
    blurb: 'Pop — each tier snaps',
    src: publicAssetUrl('/samples/expanding-boxes.png'),
    animation: 'pop',
    layers: stacked([
      'A cold email',
      'A slightly warmer email',
      'A handwritten note to {first_name|there}',
      'A note {company} will actually open',
    ]),
  },
  {
    id: 'pills',
    name: 'Hard to swallow',
    blurb: 'Shake — the bottle jumps',
    src: publicAssetUrl('/samples/pills.png'),
    animation: 'shake',
    layers: topBottom('HARD TO SWALLOW, {first_name|THERE}', 'The {company} sequence is being ignored.'),
  },
  {
    id: 'trade-cards',
    name: 'Trade offer',
    blurb: 'Slide — the cards swap',
    src: publicAssetUrl('/samples/trade-cards.png'),
    animation: 'slide',
    layers: topBottom('I RECEIVE: 15 MINUTES', 'You receive: one idea for {company}.'),
  },
  {
    id: 'balloon',
    name: 'Running balloon',
    blurb: 'Drift — the balloon leaves',
    src: publicAssetUrl('/samples/balloon.png'),
    animation: 'drift',
    photoMotion: 'drift',
    layers: topBottom('THE OLD SEQUENCE', '{first_name|there} watching replies float away.'),
  },
  {
    id: 'exit-ramp',
    name: 'Left exit',
    blurb: 'Slide — the ramp peels off',
    src: publicAssetUrl('/samples/exit-ramp.png'),
    animation: 'slide',
    layers: topBottom('KEEP BLASTING COLD EMAIL', '{first_name|there} taking the {company} note instead.'),
  },
  {
    id: 'chart-up',
    name: 'Chart up',
    blurb: 'Rise — the line lifts',
    src: publicAssetUrl('/samples/chart-up.png'),
    animation: 'rise',
    photoMotion: 'rise',
    layers: topBottom('{company} WHEN THE NOTE LANDS', '{first_name|there}, this is the idea.'),
  },
  {
    id: 'side-eye',
    name: 'Side eye',
    blurb: 'Wobble — the glance tilts',
    src: publicAssetUrl('/samples/side-eye.png'),
    animation: 'wobble',
    layers: topBottom('WHEN {company} GETS THE SAME EMAIL AGAIN', '{first_name|there} has seen this movie.'),
  },
  {
    id: 'empty-chair',
    name: 'Empty chair',
    blurb: 'Fade — the seat waits',
    src: publicAssetUrl('/samples/empty-chair.png'),
    animation: 'fade',
    layers: topBottom('SAVED YOU A SEAT, {first_name|THERE}', 'A 15-minute idea for {company}.'),
  },
  {
    id: 'four-panel',
    name: 'Four-step plan',
    blurb: 'Flip — each panel turns',
    src: publicAssetUrl('/samples/four-panel.png'),
    animation: 'flip',
    layers: stacked([
      '1. Send the usual blast',
      '2. Wait for {company}',
      '3. Wait some more',
      '4. Write {first_name|them} a note instead',
    ]),
  },
  {
    id: 'whiteboard',
    name: 'Is this the pitch?',
    blurb: 'Pulse — the board breathes',
    src: publicAssetUrl('/samples/whiteboard.jpg'),
    animation: 'pulse',
    layers: topBottom('IS THIS A PIPELINE, {first_name|THERE}?', 'Or just another slide for {company}.'),
  },
  {
    id: 'laptop-react',
    name: 'Laptop stare',
    blurb: 'Zoom — into the screen',
    src: publicAssetUrl('/samples/laptop.jpg'),
    animation: 'zoom',
    photoMotion: 'zoom',
    layers: topBottom('{first_name|THERE} OPENING THE INBOX', 'Another templated note from someone not {company}.'),
  },
  {
    id: 'they-dont-know',
    name: 'They do not know',
    blurb: 'Drift — the room floats',
    src: publicAssetUrl('/samples/office.jpg'),
    animation: 'drift',
    photoMotion: 'drift',
    layers: topBottom('THEY DO NOT KNOW', '{first_name|there} already has a better note for {company}.'),
  },
  {
    id: 'always-has',
    name: 'Always has been',
    blurb: 'Zoom — into the dark',
    src: publicAssetUrl('/samples/space.jpg'),
    animation: 'zoom',
    photoMotion: 'zoom',
    layers: topBottom('WAIT, THIS WAS A NOTE ALL ALONG?', 'Always has been, {first_name|there}.'),
  },
  {
    id: 'city-paths',
    name: 'Two cities',
    blurb: 'Fade — the skyline arrives',
    src: publicAssetUrl('/samples/city.jpg'),
    animation: 'fade',
    layers: topBottom('{city|THIS MARKET} HAS TWO ROADS', 'Spray and pray, or a note for {company}.'),
  },
  {
    id: 'coffee-think',
    name: 'I bet they are thinking',
    blurb: 'Rise — steam lifts',
    src: publicAssetUrl('/samples/coffee.jpg'),
    animation: 'rise',
    layers: topBottom('I BET {first_name|THEY} ARE THINKING ABOUT WORK', 'They are thinking about a better note for {company}.'),
  },
  {
    id: 'team-point',
    name: 'Group pointing',
    blurb: 'Pop — the team snaps',
    src: publicAssetUrl('/samples/team.jpg'),
    animation: 'pop',
    layers: topBottom('EVERYONE AT {company}', 'Pointing at the same tired sequence.'),
  },
];
