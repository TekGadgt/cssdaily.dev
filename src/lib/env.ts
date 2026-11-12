/// <reference types="@cloudflare/workers-types" />
/** Bindings and vars available to the Worker (wrangler.jsonc + Worker secrets). */
export interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  PLAYS_LIMITER: RateLimit;
  /** Canonical origin, e.g. https://cssdaily.dev (http://localhost:8787 in .dev.vars) */
  SITE_URL: string;
  /** Fine-grained PAT: this repo only, Actions read/write. Worker secret. */
  GITHUB_DISPATCH_TOKEN: string;
  /** Better Auth signing secret (openssl rand -base64 32). Worker secret. */
  BETTER_AUTH_SECRET: string;
  /** GitHub OAuth App (production: cssdaily.dev callback). Worker secrets. */
  GITHUB_CLIENT_ID: string;
  GITHUB_CLIENT_SECRET: string;
}
