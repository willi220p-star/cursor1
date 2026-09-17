import type { ChannelVariant } from '@/types/app'
import type {
  DeskSurface,
  HandwritingTemplateId,
  NoteFinish,
  SignatureFont,
} from '@/features/handwritten/templates'
import { VARIANT_SIZE } from '@/features/handwritten/templates'

export type Point = { x: number; y: number }

export type HandwrittenScene = {
  variant: ChannelVariant
  templateId: HandwritingTemplateId
  customBackground: string | null
  body: string
  postscript: string
  signatureText: string
  signatureFont: SignatureFont
  signatureImage: string | null
  fontSize: number
  lineHeight: number
  penColour: string
  finish: NoteFinish
  surface: DeskSurface
  realism: number
  seed: number
  bodyPos: Point
  psPos: Point
  signaturePos: Point
}

export function defaultPositions(variant: ChannelVariant): Pick<
  HandwrittenScene,
  'bodyPos' | 'psPos' | 'signaturePos'
> {
  const { width, height } = VARIANT_SIZE[variant]
  if (variant === 'linkedin') {
    return {
      bodyPos: { x: 90, y: 140 },
      psPos: { x: 90, y: height - 280 },
      signaturePos: { x: 90, y: height - 160 },
    }
  }
  return {
    bodyPos: { x: 80, y: 90 },
    psPos: { x: 80, y: height - 160 },
    signaturePos: { x: width - 380, y: height - 120 },
  }
}

export function textBoxWidth(variant: ChannelVariant): number {
  return variant === 'linkedin' ? 900 : 720
}

export function realismAngle(seed: number, realism: number): number {
  const unit = ((seed * 9301 + 49297) % 233280) / 233280
  return (unit - 0.5) * 4.2 * (realism / 100)
}

export function paperInset(finish: NoteFinish): number {
  if (finish === 'desk') return 56
  if (finish === 'soft-shadow') return 18
  return 0
}
