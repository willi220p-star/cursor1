/** Retries a flaky call (network, Supabase) with a growing pause. Cancellations are never retried. */
export async function withRetry<T>(
  work: () => Promise<T>,
  { retries = 2, baseMs = 400 }: { retries?: number; baseMs?: number } = {},
): Promise<T> {
  let attempt = 0;
  for (;;) {
    try {
      return await work();
    } catch (error) {
      const cancelled = error instanceof DOMException && error.name === 'AbortError';
      if (cancelled || attempt >= retries) throw error;
      await new Promise((resolve) => setTimeout(resolve, baseMs * 2 ** attempt));
      attempt += 1;
    }
  }
}

/** Plain-language text for an unknown failure. */
export function errorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'string' && error) return error;
  return fallback;
}
