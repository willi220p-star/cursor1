import { useEffect, useRef, useState } from 'react';
import { Check, Eraser, PenLine } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';

export function SignaturePad({
  open,
  onOpenChange,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (dataUrl: string) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const [empty, setEmpty] = useState(true);

  useEffect(() => {
    if (!open) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext('2d');
    if (!context) return;
    const ratio = window.devicePixelRatio || 1;
    canvas.width = 640 * ratio;
    canvas.height = 240 * ratio;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.fillStyle = '#fffdf8';
    context.fillRect(0, 0, 640, 240);
    context.strokeStyle = '#173765';
    context.lineWidth = 2.4;
    context.lineCap = 'round';
    context.lineJoin = 'round';
    setEmpty(true);
  }, [open]);

  const point = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * 640,
      y: ((event.clientY - rect.top) / rect.height) * 240,
    };
  };

  const start = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const context = canvasRef.current?.getContext('2d');
    if (!context) return;
    drawing.current = true;
    const { x, y } = point(event);
    context.beginPath();
    context.moveTo(x, y);
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const move = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    const context = canvasRef.current?.getContext('2d');
    if (!context) return;
    const { x, y } = point(event);
    context.lineTo(x, y);
    context.stroke();
    setEmpty(false);
  };

  const end = () => {
    drawing.current = false;
  };

  const clear = () => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context) return;
    context.setTransform(1, 0, 0, 1, 0, 0);
    const ratio = window.devicePixelRatio || 1;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.fillStyle = '#fffdf8';
    context.fillRect(0, 0, 640, 240);
    setEmpty(true);
  };

  const save = () => {
    const canvas = canvasRef.current;
    if (!canvas || empty) return;
    onSave(canvas.toDataURL('image/png'));
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(720px,calc(100vw-32px))] max-w-none rounded-[12px] border-border bg-card p-5 sm:max-w-none">
        <DialogHeader className="pr-10 text-left">
          <DialogTitle className="display text-2xl font-semibold">Draw a signature</DialogTitle>
          <DialogDescription>Optional. One stroke on this pad becomes the signature on the note. You can still upload a file instead.</DialogDescription>
        </DialogHeader>
        <div className="overflow-hidden rounded-md border border-input bg-[#fffdf8]">
          <canvas
            ref={canvasRef}
            className="h-[180px] w-full cursor-crosshair bg-[#fffdf8]"
            onPointerDown={start}
            onPointerMove={move}
            onPointerUp={end}
            onPointerLeave={end}
          />
        </div>
        <div className="flex flex-wrap justify-between gap-2">
          <button type="button" className="btn btn-quiet" onClick={clear}><Eraser size={16} aria-hidden /> Clear</button>
          <div className="flex gap-2">
            <button type="button" className="btn btn-ghost" onClick={() => onOpenChange(false)}>Cancel</button>
            <button type="button" className="btn btn-primary" onClick={save} disabled={empty}>
              <Check size={16} aria-hidden /> Use this signature
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function DrawSignButton({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" className="btn btn-quiet" onClick={onClick}>
      <PenLine size={16} aria-hidden /> Draw sign
    </button>
  );
}
