export async function rasterizeToCanvas(
  url: string,
  width: number,
  height: number,
): Promise<HTMLCanvasElement> {
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const element = new Image()
    element.onload = () => resolve(element)
    element.onerror = () => reject(new Error('The paper image failed to load.'))
    element.src = url
  })

  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(width))
  canvas.height = Math.max(1, Math.round(height))
  const context = canvas.getContext('2d')
  if (!context) {
    throw new Error('Could not draw the paper background.')
  }
  context.drawImage(image, 0, 0, canvas.width, canvas.height)
  return canvas
}
