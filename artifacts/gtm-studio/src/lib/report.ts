/**
 * One place every caught error goes. Crash reporting (Sentry) registers itself here when it is
 * configured; until then errors are only logged to the console.
 */
type Reporter = (error: unknown, context?: Record<string, unknown>) => void;

let reporter: Reporter | null = null;

export function setErrorReporter(next: Reporter | null) {
  reporter = next;
}

export function reportError(error: unknown, context?: Record<string, unknown>) {
  console.error(error, context ?? '');
  try {
    reporter?.(error, context);
  } catch {
    // Reporting must never break the app.
  }
}
