/**
 * Cron → GitHub workflow dispatch. GitHub disables *scheduled* workflows
 * after 60 days without repo activity, so the targets carry no `schedule:`
 * and are started from here instead (Cloudflare crons have no such rule).
 */
export const REPO = 'TekGadgt/cssdaily.dev';

/**
 * Cron expression → workflow file. Keys must match wrangler.jsonc
 * `triggers.crons` exactly: `controller.cron` is that string. UTC. Use day
 * names: Cloudflare numbers days 1–7 from Sunday and rejects 0.
 */
export const CRON_WORKFLOWS: Record<string, string> = {
  '0 6 * * *': 'generate-challenge.yml',
  '0 3 * * SUN': 'backup.yml',
};

export async function dispatchWorkflow(file: string, token: string, fetchFn: typeof fetch = fetch): Promise<void> {
  if (!token) throw new Error('GITHUB_DISPATCH_TOKEN is not set');
  const res = await fetchFn(`https://api.github.com/repos/${REPO}/actions/workflows/${file}/dispatches`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      // GitHub rejects requests without a User-Agent
      'User-Agent': 'cssdaily-cron',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ ref: 'main' }),
  });
  if (res.status !== 204) {
    let detail = '';
    try { detail = ((await res.json()) as { message?: string }).message ?? ''; } catch {}
    // Loud on purpose: a thrown error is a failed scheduled invocation in Workers Logs
    throw new Error(`Dispatching ${file} failed: HTTP ${res.status}${detail ? ` — ${detail}` : ''}`);
  }
  console.log(`Dispatched ${file} on main`);
}

export async function dispatchForCron(cron: string, token: string, fetchFn: typeof fetch = fetch): Promise<void> {
  const file = CRON_WORKFLOWS[cron];
  if (!file) throw new Error(`No workflow mapped to cron "${cron}"`);
  await dispatchWorkflow(file, token, fetchFn);
}
