import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/button'
import { Card, CardDescription, CardTitle } from '@/components/ui/card'

export function MemesPage() {
  const [imageSrc, setImageSrc] = useState<string | null>(null)
  const [topText, setTopText] = useState('')
  const [bottomText, setBottomText] = useState('')
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    return () => {
      if (imageSrc) {
        URL.revokeObjectURL(imageSrc)
      }
    }
  }, [imageSrc])

  function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return
    setImageSrc((previous) => {
      if (previous) URL.revokeObjectURL(previous)
      return URL.createObjectURL(file)
    })
  }

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !imageSrc) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const image = new Image()
    image.crossOrigin = 'anonymous'
    image.onload = () => {
      const maxWidth = 800
      const scale = Math.min(1, maxWidth / image.width)
      canvas.width = image.width * scale
      canvas.height = image.height * scale
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height)

      const fontSize = Math.round(canvas.width / 10)
      ctx.font = `900 ${fontSize}px Impact, "Arial Black", sans-serif`
      ctx.textAlign = 'center'
      ctx.lineWidth = Math.max(2, fontSize / 12)
      ctx.strokeStyle = '#000000'
      ctx.fillStyle = '#ffffff'

      const drawText = (text: string, y: number) => {
        const value = text.trim().toUpperCase()
        if (!value) return
        ctx.strokeText(value, canvas.width / 2, y)
        ctx.fillText(value, canvas.width / 2, y)
      }

      drawText(topText, fontSize + 8)
      drawText(bottomText, canvas.height - 16)
    }
    image.src = imageSrc
  }, [imageSrc, topText, bottomText])

  function handleDownload() {
    const canvas = canvasRef.current
    if (!canvas || !imageSrc) return
    const link = document.createElement('a')
    link.download = 'meme.png'
    link.href = canvas.toDataURL('image/png')
    link.click()
  }

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        eyebrow="Memes"
        title="Meme studio"
        description="Upload an image, add a top and bottom caption, and export a shareable PNG. Everything is generated locally in your browser."
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <Card className="flex flex-col gap-5">
          <div>
            <CardTitle>Build</CardTitle>
            <CardDescription>Choose an image and add your captions.</CardDescription>
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="image" className="text-sm font-medium text-navy-ink">
              Image
            </label>
            <input
              id="image"
              type="file"
              accept="image/*"
              onChange={handleFile}
              className="block w-full text-sm text-stone-gray file:mr-4 file:rounded-[1584px] file:border-0 file:bg-navy-ink file:px-4 file:py-2 file:text-sm file:font-medium file:text-paper-white hover:file:bg-navy-ink/90"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="top" className="text-sm font-medium text-navy-ink">
              Top caption
            </label>
            <input
              id="top"
              value={topText}
              onChange={(event) => setTopText(event.target.value)}
              placeholder="When the demo finally works"
              className="h-11 w-full rounded-[12px] border border-sand-border bg-paper-white px-4 text-sm text-navy-ink placeholder:text-ash-gray focus:outline-none focus:ring-2 focus:ring-violet-pulse/30"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="bottom" className="text-sm font-medium text-navy-ink">
              Bottom caption
            </label>
            <input
              id="bottom"
              value={bottomText}
              onChange={(event) => setBottomText(event.target.value)}
              placeholder="On the first try"
              className="h-11 w-full rounded-[12px] border border-sand-border bg-paper-white px-4 text-sm text-navy-ink placeholder:text-ash-gray focus:outline-none focus:ring-2 focus:ring-violet-pulse/30"
            />
          </div>

          <Button variant="primary" size="md" onClick={handleDownload} disabled={!imageSrc}>
            Download PNG
          </Button>
        </Card>

        <Card className="flex flex-col gap-4 bg-warm-cream">
          <CardTitle>Preview</CardTitle>
          {imageSrc ? (
            <div className="overflow-hidden rounded-[12px] border border-sand-border bg-paper-white">
              <canvas ref={canvasRef} className="h-auto w-full" />
            </div>
          ) : (
            <div className="flex min-h-[280px] items-center justify-center rounded-[12px] border border-dashed border-sand-border bg-paper-white p-6 text-center text-sm text-ash-gray">
              Upload an image to start building your meme.
            </div>
          )}
        </Card>
      </div>
    </div>
  )
}
