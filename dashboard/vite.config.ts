import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Single source of truth for the version shown in the dashboard: the ROOT package.json, which is
// what a release bumps and what `npm run check:versions` gates. Resolved relative to this config
// file (not process.cwd()), because the dashboard is normally built from inside `dashboard/` — where
// cwd-relative resolution picks up `dashboard/package.json` instead. That file is not touched by a
// release, so the Login screen kept rendering whatever version it happened to be pinned at while the
// gateway moved on. The sidebar hid the drift by replacing the build-time value with the live
// version from the API (see Layout.tsx); the Login screen has no session yet, so it shows this
// constant verbatim. APP_VERSION env still overrides if explicitly provided.
const { version: pkgVersion } = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf-8'),
) as {
  version: string;
};

// The dashboard normally lives at `/`, but reverse proxies may mount the complete gateway under
// a path such as `/openwa`. Vite needs this at BUILD time so every hashed asset URL carries the
// prefix. Keep one leading and one trailing slash; Vite's import.meta.env.BASE_URL then becomes the
// runtime source of truth for the router, API client and Socket.IO path.
const rawBasePath = (process.env.VITE_BASE_PATH || '/').trim();
const dashboardBasePath = rawBasePath === '/' ? '/' : `/${rawBasePath.replace(/^\/+|\/+$/g, '')}/`;

// https://vite.dev/config/
export default defineConfig({
  base: dashboardBasePath,
  plugins: [react()],
  appType: 'spa', // Enable SPA fallback for client-side routing
  define: {
    __APP_VERSION__: JSON.stringify(process.env.APP_VERSION || pkgVersion),
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
  server: {
    port: 2886,
    proxy: {
      '/api': {
        target: 'http://localhost:2785',
        changeOrigin: true,
        secure: false,
      },
      // Proxy the WebSocket (socket.io) transport so the dashboard's real-time
      // chats/sessions streams work against the dev backend.
      '/socket.io': {
        target: 'http://localhost:2785',
        ws: true,
        changeOrigin: true,
      },
    },
  },
});
