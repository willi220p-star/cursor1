import type { Canvas } from 'fabric'

export function fitFabricPreview(
  canvas: Canvas,
  host: HTMLElement,
  logicalWidth: number,
  logicalHeight: number,
) {
  const cssWidth = host.clientWidth
  const cssHeight = host.clientHeight || cssWidth * (logicalHeight / logicalWidth)
  if (cssWidth < 2 || cssHeight < 2) return
  canvas.setDimensions({ width: `${cssWidth}px`, height: `${cssHeight}px` }, { cssOnly: true })
}
