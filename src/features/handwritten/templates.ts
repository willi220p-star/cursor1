import type { ChannelVariant } from '@/types/app'

export const VARIANT_SIZE: Record<ChannelVariant, { width: number; height: number }> = {
  email: { width: 1200, height: 628 },
  linkedin: { width: 1080, height: 1080 },
}

export const PEN_COLOURS = [
  { id: 'blue-ballpoint', label: 'Blue ballpoint', value: '#1f4f8a' },
  { id: 'navy', label: 'Navy', value: '#1e3a5f' },
  { id: 'black', label: 'Black', value: '#1a1a1a' },
  { id: 'dark-red', label: 'Red', value: '#7a1f1f' },
  { id: 'dark-green', label: 'Dark green', value: '#1f4d2e' },
] as const

export type NoteFinish = 'desk' | 'scanned' | 'soft-shadow' | 'clean'
export type DeskSurface = 'wood' | 'slate' | 'linen'

export const NOTE_FINISHES: { id: NoteFinish; label: string }[] = [
  { id: 'desk', label: 'Photo on a desk' },
  { id: 'scanned', label: 'Scanned' },
  { id: 'soft-shadow', label: 'Soft shadow' },
  { id: 'clean', label: 'Clean paper' },
]

export const DESK_SURFACES: { id: DeskSurface; label: string; fill: string }[] = [
  { id: 'wood', label: 'Wooden desk', fill: '#6b4a2e' },
  { id: 'slate', label: 'Dark slate', fill: '#2a2d32' },
  { id: 'linen', label: 'Linen', fill: '#d9d0c3' },
]

export type HandwritingTemplateId =
  | 'casual-cursive'
  | 'neat-print'
  | 'rushed-scrawl'
  | 'bold-marker'
  | 'fine-pen'
  | 'post-it'

export type HandwritingTemplate = {
  id: HandwritingTemplateId
  name: string
  paper: string
  fontFamily: string
}

export const HANDWRITING_TEMPLATES: HandwritingTemplate[] = [
  {
    id: 'casual-cursive',
    name: 'Casual Cursive',
    paper: 'Lined paper',
    fontFamily: '"Homemade Apple", cursive',
  },
  {
    id: 'neat-print',
    name: 'Neat Print',
    paper: 'Blank cream card',
    fontFamily: '"Patrick Hand", cursive',
  },
  {
    id: 'rushed-scrawl',
    name: 'Rushed Scrawl',
    paper: 'Kraft paper',
    fontFamily: '"Shadows Into Light", cursive',
  },
  {
    id: 'bold-marker',
    name: 'Bold Marker',
    paper: 'White card',
    fontFamily: '"Permanent Marker", cursive',
  },
  {
    id: 'fine-pen',
    name: 'Fine Pen',
    paper: 'Ruled notebook paper',
    fontFamily: '"Reenie Beanie", cursive',
  },
  {
    id: 'post-it',
    name: 'Post-it Note',
    paper: 'Yellow square',
    fontFamily: 'Caveat, cursive',
  },
]

export const SIGNATURE_FONTS = ['Caveat', 'Dancing Script'] as const
export type SignatureFont = (typeof SIGNATURE_FONTS)[number]
