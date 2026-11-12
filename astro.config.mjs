// @ts-check
import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import tailwind from '@astrojs/tailwind';

// https://astro.build/config
// A purely static build: every page is prerendered. The few dynamic
// endpoints live in a small, separate Worker script (src/worker.ts) that
// only receives requests no static asset matched.
export default defineConfig({
  site: 'https://cssdaily.dev',
  trailingSlash: 'ignore',
  integrations: [react(), tailwind()],
});
