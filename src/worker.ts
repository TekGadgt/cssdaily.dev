import type { Env } from './lib/env';
import { dispatchForCron } from './lib/dispatch';
import { handlePlay } from './worker/plays';

/**
 * The site is fully static (Workers Static Assets). With asset-first
 * routing this script only ever sees requests no static file matched, so
 * it stays small: the plays counter, Better Auth, the cron dispatch, and a hand-back
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

    // Better Auth: sign-in, OAuth callback, session, sign-out, deletion.
    // Built per request (D1 is only bound inside a request).
    if (pathname.startsWith('/api/auth/')) {
      try {
        // Loaded on first use: Better Auth is ~1.8 MB of the bundle, and no
        // other route should pay to evaluate it.
        const { createAuth } = await import('./lib/auth');
        return await createAuth(env).handler(request);
      } catch (err) {
        console.error('auth:', err instanceof Error ? err.message : err);
        return new Response(null, { status: 500 });
      }
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
