import type { ErrorEvent } from '@sentry/react';
import { setErrorReporter } from './report';

// Prospect lists hold names, emails and phone numbers. None of that may leave the browser in a report.
const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const PHONE = /\+?\d[\d\s().-]{7,}\d/g;

export function scrubText(value: string) {
  return value.replace(EMAIL, '[email]').replace(PHONE, '[phone]');
}

export function scrubEvent(event: ErrorEvent): ErrorEvent {
  delete event.user;
  if (event.request) {
    delete event.request.cookies;
    delete event.request.data;
    if (event.request.url) event.request.url = event.request.url.split('?')[0];
  }
  if (event.message) event.message = scrubText(event.message);
  event.exception?.values?.forEach((value) => {
    if (value.value) value.value = scrubText(value.value);
    value.stacktrace?.frames?.forEach((frame) => { delete frame.vars; });
  });
  // Console and UI breadcrumbs can carry row contents; keep only navigation and network shape.
  event.breadcrumbs = (event.breadcrumbs ?? [])
    .filter((crumb) => crumb.category === 'navigation' || crumb.category === 'fetch' || crumb.category === 'xhr')
    .map((crumb) => ({ ...crumb, message: crumb.message ? scrubText(crumb.message) : undefined, data: crumb.data?.url ? { url: String(crumb.data.url).split('?')[0], status_code: crumb.data.status_code } : undefined }));
  delete event.extra;
  return event;
}

/** Starts crash reporting when a DSN is configured at build time; otherwise does nothing. */
export async function initCrashReports() {
  const dsn = import.meta.env.VITE_SENTRY_DSN as string | undefined;
  if (!dsn) return;
  const Sentry = await import('@sentry/react');
  Sentry.init({
    dsn,
    environment: import.meta.env.MODE,
    sendDefaultPii: false,
    tracesSampleRate: 0,
    beforeSend: (event) => scrubEvent(event),
  });
  setErrorReporter((error, context) => {
    const area = typeof context?.area === 'string' ? context.area : 'app';
    Sentry.captureException(error, { tags: { area } });
  });
}
