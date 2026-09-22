import path from 'path';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

import runtimeErrorOverlay from '@replit/vite-plugin-runtime-error-modal';

const port = Number(process.env.PORT ?? '43123');

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${process.env.PORT ?? ''}"`);
}

const basePath = process.env.BASE_PATH ?? '/';

export default defineConfig({
  envDir: path.resolve(import.meta.dirname, '../..'),
  base: basePath,
  plugins: [
    {
      name: 'preview-keepalive',
      configureServer(server) {
        // Vite's HTTP server defaults keepAliveTimeout to 5s. Cursor's preview
        // proxy reuses sockets past that, then Node RSTs them → ERR_EMPTY_RESPONSE.
        const apply = () => {
          const httpServer = server.httpServer;
          if (!httpServer) return;
          // Cursor preview and Cloudflare reuse sockets well past Node's 5s default.
          httpServer.keepAliveTimeout = 120_000;
          httpServer.headersTimeout = 125_000;
          httpServer.timeout = 0;
          httpServer.requestTimeout = 0;
        };
        apply();
        server.httpServer?.once('listening', apply);
      },
    },
    react(),
    tailwindcss(),
    runtimeErrorOverlay(),
    ...(process.env.NODE_ENV !== 'production' &&
    process.env.REPL_ID !== undefined
      ? [
          await import('@replit/vite-plugin-cartographer').then((m) =>
            m.cartographer({
              root: path.resolve(import.meta.dirname, '..'),
            }),
          ),
          await import('@replit/vite-plugin-dev-banner').then((m) =>
            m.devBanner(),
          ),
        ]
      : []),
  ],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, 'src'),
      '@assets': path.resolve(
        import.meta.dirname,
        '..',
        '..',
        'attached_assets',
      ),
    },
    dedupe: ['react', 'react-dom'],
  },
  root: path.resolve(import.meta.dirname),
  build: {
    outDir: path.resolve(import.meta.dirname, 'dist/public'),
    emptyOutDir: true,
  },
  server: {
    port,
    strictPort: true,
    host: '0.0.0.0',
    allowedHosts: true,
    fs: {
      strict: true,
    },
  },
  preview: {
    port,
    host: '0.0.0.0',
    allowedHosts: true,
  },
});
