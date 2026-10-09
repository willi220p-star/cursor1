import { memeSamples } from './meme-samples';
import { modeLabel } from './renderer';
import {
  avatarInNoteLayout,
  defaultCrop,
  finishPaperZone,
  isHandwritingFamily,
  migrateDeskSurface,
  migrateWritingHand,
  migrateWritingSpeed,
  zonesOverlap,
  type PaperKind,
  type StudioConfig,
  type StudioMode,
  type TextLayer,
} from './types';

export const templateOptions: Record<StudioMode, string[]> = {
  handwritten: ['Notebook', 'White paper', 'Diary'],
  avatar: ['Portrait + note', 'Circle headshot', 'Rounded card', 'Square cutout', 'Field note / Lined'],
  memes: ['Bold contrast', 'Before / after', 'Decision tension', 'Escalation', 'Status quo pain', 'Debate card', 'Custom image'],
  gif: ['Fade statement', 'Slide reveal', 'Two-state flip', 'Custom GIF or image'],
  handgif: ['Notebook', 'White paper', 'Diary'],
};

export const defaultLayers: TextLayer[] = [
  {
    id: 'headline',
    name: 'Headline',
    text: 'HEY {first_name|THERE}',
    x: 0.08,
    y: 0.08,
    width: 0.84,
    height: 0.18,
    fontSize: 78,
    align: 'center',
    color: '#ffffff',
    outline: true,
    animation: 'still',
    highlight: '',
    highlightColor: '#ffe566',
  },
  {
    id: 'footer',
    name: 'Footer',
    text: '{company} deserves better outbound.',
    x: 0.08,
    y: 0.76,
    width: 0.84,
    height: 0.16,
    fontSize: 48,
    align: 'center',
    color: '#ffffff',
    outline: true,
    animation: 'still',
    highlight: '',
    highlightColor: '#ffe566',
  },
];

/**
 * New meme campaigns start on a real photo, like a meme people actually send. "Stressed laptop" reads
 * instantly as outbound pain for any B2B buyer, is square for LinkedIn and has room for a caption top and bottom.
 */
export const defaultMemeSampleId = 'stressed-laptop';

function defaultMemeSample() {
  return memeSamples.find((sample) => sample.id === defaultMemeSampleId) ?? memeSamples[0];
}

export function defaultConfig(mode: StudioMode): StudioConfig {
  const paper = mode === 'handwritten' || mode === 'avatar' || mode === 'handgif';
  const handwriting = mode === 'handwritten' || mode === 'handgif';
  // Notes default to a landscape card: the whole note shows in an email or LinkedIn preview.
  const channel = handwriting ? 'Card' : paper ? 'A4' : 'LinkedIn';
  const layout = mode === 'avatar' ? avatarInNoteLayout(channel, 0.24, finishPaperZone('desk')) : null;
  const paperKind: PaperKind = mode === 'avatar' ? 'white-paper' : 'notebook';
  const memeSample = mode === 'memes' ? defaultMemeSample() : undefined;
  return {
    mode,
    campaignName: `${modeLabel(mode)} campaign`,
    template: memeSample ? 'Custom image' : templateOptions[mode][0],
    customImage: memeSample?.src,
    copy:
      mode === 'memes' || mode === 'gif'
        ? 'HEY {first_name|THERE}'
        : 'Hi {first_name|there},\n\nLoved what {company|your team} is building. I have one idea that could help a {role|leader} in {city|your market} create more qualified conversations.\n\n{msg|Worth a quick chat next week?}',
    filename: mode === 'avatar'
      ? '{first_name}_{company}_{row}_avatar'
      : mode === 'handwritten'
        ? '{company}_{first_name}_{row}_note'
        : mode === 'handgif'
          ? '{company}_{first_name}_{row}_writing'
          : `{company}_{row}_${mode}`,
    channel,
    // Notes are sized to fill the default card.
    fontSize: mode === 'avatar' ? 28 : handwriting ? 50 : 44,
    inkColor: '#173765',
    paperColor: paperKind === 'white-paper' ? '#ffffff' : '#f7f0e1',
    paperColorPreset: paperKind === 'white-paper' ? 'white' : 'cream',
    paperKind,
    fontFamily: mode === 'avatar' ? 'Space Grotesk' : handwriting ? 'Caveat' : 'Homemade Apple',
    postscript: '',
    lineSpacing: mode === 'avatar' ? 1.45 : 1.35,
    letterSpacing: 0,
    noteX: mode === 'avatar' ? 0.08 : 0.12,
    noteY: mode === 'avatar' ? 0.08 : 0.16,
    realism: mode === 'avatar' ? 8 : 78,
    seed: 7,
    finish: mode === 'handwritten' ? 'photo' : 'desk',
    surface: 'pine',
    deskColor: '#c08a4a',
    ruledLines: paperKind !== 'white-paper',
    showMargin: paperKind === 'notebook',
    shuffleHandwriting: false,
    shuffleFinish: false,
    handwritingKind: 'natural',
    writingHand: 'liner',
    writingSpeed: 'medium',
    signature: '– Alex',
    gifFps: mode === 'handgif' ? 10 : 12,
    gifLoop: 0,
    gifQuality: 7,
    photoMotion: 'still',
    effect: 'none',
    avatarShape: 'circle',
    message: '{msg|Loved what you shipped.}',
    showMessage: true,
    imageCrop: { ...defaultCrop },
    avatarCrop: { ...defaultCrop },
    websiteZone: { x: 0.12, y: 0.24, width: 0.76, height: 0.46 },
    avatarZone: layout?.avatar ?? { x: 0.73, y: 0.73, width: 0.18, height: 0.18 },
    noteZone: layout?.note ?? finishPaperZone('desk'),
    textZone: layout?.text ?? { x: 0.18, y: 0.18, width: 0.64, height: 0.58 },
    avatarColumn: mode === 'avatar' ? 'avatar' : undefined,
    messageColumn: mode === 'avatar' ? 'msg' : undefined,
    // A classic meme is a still image; pick a motion in the Look tab to make it a GIF.
    animation: mode === 'memes' ? 'still' : mode === 'gif' ? 'fade' : 'still',
    textMotion: mode === 'avatar' ? 'type' : 'still',
    layers: memeSample ? memeSample.layers.map((layer) => ({ ...layer })) : defaultLayers,
  };
}

export function normalizeConfig(mode: StudioMode, value: StudioConfig) {
  const defaults = defaultConfig(mode);
  const fontFamily = mode === 'avatar' && isHandwritingFamily(value.fontFamily)
    ? 'Space Grotesk'
    : (value.fontFamily ?? defaults.fontFamily);
  const layout = mode === 'avatar'
    ? avatarInNoteLayout(value.channel ?? defaults.channel, value.avatarZone?.width ?? 0.24, defaults.noteZone)
    : null;
  const savedNote = value.noteZone ?? defaults.noteZone;
  const savedAvatar = value.avatarZone ?? defaults.avatarZone;
  const inNote = mode !== 'avatar' || zonesOverlap(savedAvatar, savedNote);
  return {
    ...defaults,
    ...value,
    mode,
    fontFamily,
    // A saved look without a photo stays without one: the default meme photo is for new campaigns only.
    customImage: value.customImage,
    websiteZone: value.websiteZone ?? defaults.websiteZone,
    noteZone: inNote ? savedNote : (layout?.note ?? defaults.noteZone),
    avatarZone: inNote ? savedAvatar : (layout?.avatar ?? defaults.avatarZone),
    textZone: value.textZone ?? layout?.text ?? defaults.textZone,
    imageCrop: value.imageCrop ?? defaults.imageCrop,
    avatarCrop: value.avatarCrop ?? defaults.avatarCrop,
    avatarShape: value.avatarShape ?? defaults.avatarShape,
    avatarColumn: mode === 'avatar' ? (value.avatarColumn ?? defaults.avatarColumn) : undefined,
    avatarImage: mode === 'avatar' ? value.avatarImage : undefined,
    avatarUrl: mode === 'avatar' ? value.avatarUrl : undefined,
    message: value.message ?? defaults.message,
    // Unset means underline; anything unknown from an old save is dropped.
    hookMark: (['underline', 'circle', 'none'] as const).find((mark) => mark === value.hookMark),
    showMessage: value.showMessage ?? defaults.showMessage,
    layers: (value.layers?.length ? value.layers : defaults.layers).map((layer) => ({
      ...layer,
      height: layer.height ?? .16,
      animation: layer.animation ?? 'still',
      highlight: layer.highlight ?? '',
      highlightColor: layer.highlightColor ?? '#ffe566',
    })),
    surface: migrateDeskSurface(value.surface ?? defaults.surface),
    writingHand: migrateWritingHand(value.writingHand ?? defaults.writingHand),
    writingSpeed: migrateWritingSpeed(value.writingSpeed ?? defaults.writingSpeed),
    deskColor: value.deskColor ?? defaults.deskColor,
    paperKind: value.paperKind ?? defaults.paperKind,
    paperColorPreset: value.paperColorPreset ?? defaults.paperColorPreset,
    paperColor: value.paperColor ?? defaults.paperColor,
    channel: value.channel ?? defaults.channel,
    textMotion: value.textMotion ?? defaults.textMotion,
    listSource: value.listSource,
    sourceColumns: value.sourceColumns,
    sourceFileUrl: value.sourceFileUrl,
  };
}
