import type { SavedCampaign, SavedTemplate, StudioMode } from './types';

/** Every place that lists studios (nav, desk tiles, search) reads this one list. */
export type StudioKey = StudioMode | 'carousel';

export type StudioInfo = {
  key: StudioKey;
  href: string;
  /** Short name for the nav and tiles. */
  label: string;
  /** Longer name used in headings and library rows. */
  title: string;
  description: string;
};

export const studios: StudioInfo[] = [
  { key: 'handwritten', href: '/handwritten', label: 'Notes', title: 'Handwritten notes', description: 'Handwritten A4 notes on real paper, one for every prospect.' },
  { key: 'handgif', href: '/handgif', label: 'Handwriting GIF', title: 'Handwriting GIF', description: 'A pen writes the note while they watch.' },
  { key: 'avatar', href: '/avatar', label: 'Avatar', title: 'Avatar cards', description: 'Portrait cards that type out your message.' },
  { key: 'memes', href: '/memes', label: 'Memes', title: 'Moving memes', description: 'Moving memes made from copyright-safe photos.' },
  { key: 'gif', href: '/gif', label: 'GIFs', title: 'Animated GIFs', description: 'Your own GIF with styled text on top.' },
  { key: 'carousel', href: '/carousel', label: 'Carousel', title: 'Carousel generator', description: 'LinkedIn carousels, exported as a PDF.' },
];

export function studioInfo(key: StudioKey) {
  return studios.find((studio) => studio.key === key) ?? studios[0];
}

export function studioInitial(key: StudioKey) {
  return studioInfo(key).label.charAt(0);
}

/**
 * Hand a saved campaign or template to its studio. The studio reads and clears these keys
 * on mount (studio-generator.tsx), so the write must happen before navigating.
 */
export function openCampaignInStudio(scope: string, campaign: SavedCampaign, navigate: (to: string) => void) {
  localStorage.setItem(`gtm-studio-load-campaign:${scope}`, JSON.stringify(campaign));
  navigate(studioInfo(campaign.mode).href);
}

export function openTemplateInStudio(scope: string, template: SavedTemplate, navigate: (to: string) => void) {
  localStorage.setItem(`gtm-studio-load-template:${scope}`, JSON.stringify(template));
  navigate(studioInfo(template.mode).href);
}
