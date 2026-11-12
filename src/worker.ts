import type { SSRManifest } from 'astro';
import { App } from 'astro/app';
import { handle } from '@astrojs/cloudflare/handler';
import type { Env } from './lib/env';
import { dispatchForCron } from './lib/dispatch';

/**
 * Worker entry (adapter `workerEntryPoint`). Static assets never reach this
 * code — they're served first by Workers Static Assets.
 */
export function createExports(manifest: SSRManifest) {
  const app = new App(manifest);

  return {
    default: {
      async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
        // Unmatched paths go straight to the assets layer, whose
        // not_found_handling serves 404.html AT THE REQUESTED URL with status
        // 404 — the contract ChallengeRedirect.astro relies on. (The adapter's
        // default handler would discard that 404 and render its own.)
        if (!app.match(request)) return env.ASSETS.fetch(request);
        return handle(manifest, app, request as never, env as never, ctx as never) as unknown as Response;
      },

      async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
        ctx.waitUntil(dispatchForCron(controller.cron, env.GITHUB_DISPATCH_TOKEN));
      },
    } satisfies ExportedHandler<Env>,
  };
}
