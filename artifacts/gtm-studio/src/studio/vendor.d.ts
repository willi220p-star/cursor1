declare module 'gifenc' {
  export function GIFEncoder(options?: { auto?: boolean; initialCapacity?: number }): {
    writeFrame(index: Uint8Array, width: number, height: number, options: Record<string, unknown>): void;
    finish(): void;
    reset(): void;
    bytes(): Uint8Array;
    bytesView(): Uint8Array;
    readonly stream: {
      writeByte(byte: number): void;
      writeBytesView(data: Uint8Array, offset?: number, byteLength?: number): void;
    };
  };
  export function quantize(rgba: Uint8ClampedArray, colors: number): number[][];
  export function applyPalette(rgba: Uint8ClampedArray, palette: number[][]): Uint8Array;
}
