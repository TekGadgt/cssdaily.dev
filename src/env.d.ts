/// <reference types="astro/client" />
/// <reference types="@cloudflare/workers-types" />

type Runtime = import('@astrojs/cloudflare').Runtime<import('./lib/env').Env>;

declare namespace App {
  interface Locals extends Runtime {}
}
