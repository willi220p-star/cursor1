import { createRoot } from 'react-dom/client';

import App from './App';
import { ErrorBoundary } from '@/components/error-boundary';
import { initCrashReports } from '@/lib/crash-reports';
import { initOfflineQueue } from '@/lib/offline-queue';
// Register the offline-queue handlers before queued work replays.
import '@/studio/bulk';
import '@/studio/reviews';

import './index.css';

void initCrashReports();
void initOfflineQueue();

createRoot(document.getElementById('root')!, {
  // Keeps caught errors off reportError(), which would raise the dev overlay.
  onCaughtError: (error, errorInfo) => {
    console.error(error, errorInfo.componentStack);
  },
}).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>,
);
