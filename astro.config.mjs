// @ts-check
import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import tailwind from '@astrojs/tailwind';
import cloudflare from '@astrojs/cloudflare';

// https://astro.build/config
export default defineConfig({
  site: 'https://cssdaily.dev',
  trailingSlash: 'ignore',
  // Every page stays prerendered (static assets never invoke the Worker);
  // only src/pages/api/** opts out with `export const prerender = false`.
  output: 'static',
  adapter: cloudflare({
    // Custom entry: adds the cron `scheduled` handler and keeps the
    // asset 404 page for unmatched paths (see src/worker.ts)
    workerEntryPoint: { path: 'src/worker.ts', namedExports: [] },
    // No runtime image endpoint; the site doesn't use astro:assets
    imageService: 'compile',
  }),
  integrations: [react(), tailwind()],
});
