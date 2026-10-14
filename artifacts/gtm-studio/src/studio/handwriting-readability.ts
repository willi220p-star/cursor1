/**
 * Phone readability of a handwriting font: Good, OK or Small, from measurements.
 *
 * The setting is the one the app recommends for cold email: the Phone-first preset (1080 px portrait,
 * Font size 56) shown in a phone email (330 px wide). For a font with measured x-height `x` and pen width `s`
 * (shares of the font size, handwriting-metrics.json) and size scale `k`:
 *   on-screen x-height = fontSize * k * x * shown / canvas width
 *   on-screen pen width = fontSize * k * s * shown / canvas width
 *
 * Thresholds (CSS px on the phone screen):
 *  - x-height: the app's legibility bar is LEGIBLE_HANDWRITING_PX (14) at HANDWRITING_X_HEIGHT (0.45), 6.3 px
 *    of x-height. Below that is Small. Good needs 10% headroom (7.0 px) so one fitting step down stays legible.
 *  - pen width: stems of 14 px body text are about 1 px thick, so Good needs 1.0 px. Under 0.7 px (1.4 device
 *    pixels on a 2x phone) a pen line anti-aliases to grey and is Small.
 * Anything in between is OK.
 */
import { displayWidth, effectiveSize, HANDWRITING_X_HEIGHT, inboxSurfaces, LEGIBLE_HANDWRITING_PX } from './inbox-check';
import { audiencePreset } from './audience';
import { canvasSizes } from './types';
import type { HandwritingStyle, PhoneReadability } from './handwriting-fonts';

export const PHONE_X_HEIGHT_SMALL = LEGIBLE_HANDWRITING_PX * HANDWRITING_X_HEIGHT;
export const PHONE_X_HEIGHT_GOOD = 7;
export const PHONE_STROKE_SMALL = 0.7;
export const PHONE_STROKE_GOOD = 1;

export function phoneScene() {
  const preset = audiencePreset('phone');
  const canvas = canvasSizes[preset.channel];
  const surface = inboxSurfaces.find((item) => item.id === preset.surface) ?? inboxSurfaces[1];
  return { fontSize: preset.fontSize, canvas, shown: displayWidth(surface, canvas) };
}

export function phoneNumbers(style: Pick<HandwritingStyle, 'scale' | 'xHeight' | 'stroke'>) {
  const { fontSize, canvas, shown } = phoneScene();
  const size = effectiveSize(fontSize * style.scale, canvas.width, shown);
  return { xHeightPx: size * style.xHeight, strokePx: size * style.stroke };
}

export function phoneTag(numbers: { xHeightPx: number; strokePx: number }): PhoneReadability {
  if (numbers.xHeightPx < PHONE_X_HEIGHT_SMALL || numbers.strokePx < PHONE_STROKE_SMALL) return 'small';
  if (numbers.xHeightPx >= PHONE_X_HEIGHT_GOOD && numbers.strokePx >= PHONE_STROKE_GOOD) return 'good';
  return 'ok';
}

export const phoneTagLabel: Record<PhoneReadability, string> = { good: 'Good on phones', ok: 'OK on phones', small: 'Small on phones' };
