import type { Env } from './lib/env';
import { dispatchForCron } from './lib/dispatch';
import { handlePlay } from './worker/plays';

/**
 * The site is fully static (Workers Static Assets). With asset-first
 * routing this script only ever sees requests no static file matched, so
 * it stays tiny: a couple of API routes, the cron dispatch, and a hand-back
 * to the assets layer for everything else.
 */
export default {
  async fetch(request, env): Promise<Response> {
    const { pathname } = new URL(request.url);

    if (pathname === '/api/plays') {
      return request.method === 'POST'
        ? handlePlay(request, env)
        : new Response(null, { status: 405, headers: { Allow: 'POST' } });
    }

    // Unmatched: the assets layer's not_found_handling serves 404.html AT
    // THE REQUESTED URL with status 404 — the contract ChallengeRedirect.astro
    // relies on.
    return env.ASSETS.fetch(request);
  },

  async scheduled(controller, env, ctx): Promise<void> {
    ctx.waitUntil(dispatchForCron(controller.cron, env.GITHUB_DISPATCH_TOKEN));
  },
} satisfies ExportedHandler<Env>;
