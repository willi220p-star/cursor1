import type { Contact, StudioConfig } from './types';

export function createBatchRenderer() {
  const worker = new Worker(new URL('./batch.worker.ts', import.meta.url), { type: 'module' });
  const pending = new Map<string, { resolve: (blob: Blob) => void; reject: (error: Error) => void }>();
  worker.onmessage = (event) => {
    const callback = pending.get(event.data.id);
    if (!callback) return;
    pending.delete(event.data.id);
    if (event.data.error) callback.reject(new Error(event.data.error));
    else callback.resolve(event.data.blob as Blob);
  };
  worker.onerror = () => {
    pending.forEach(({ reject }) => reject(new Error('Batch rendering worker failed.')));
    pending.clear();
  };
  return {
    render(config: StudioConfig, contact: Contact) {
      const id = crypto.randomUUID();
      return new Promise<Blob>((resolve, reject) => {
        pending.set(id, { resolve, reject });
        worker.postMessage({ id, config, contact });
      });
    },
    terminate() {
      worker.terminate();
      pending.forEach(({ reject }) => reject(new DOMException('Generation cancelled', 'AbortError')));
      pending.clear();
    },
  };
}
