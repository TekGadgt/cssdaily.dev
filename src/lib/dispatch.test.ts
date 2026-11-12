import { describe, expect, it, vi } from 'vitest';
import * as fs from 'fs';
import { CRON_WORKFLOWS, dispatchForCron, dispatchWorkflow } from './dispatch';

const noContent = () => new Response(null, { status: 204 });

describe('cron dispatch', () => {
  it('maps each cron to its workflow and rejects unknown expressions', async () => {
    const fetchFn = vi.fn(async () => noContent());
    await dispatchForCron('0 6 * * *', 'tok', fetchFn);
    await dispatchForCron('0 3 * * 0', 'tok', fetchFn);
    expect(fetchFn.mock.calls.map((c) => (c as unknown as [string])[0])).toEqual([
      'https://api.github.com/repos/TekGadgt/cssdaily.dev/actions/workflows/generate-challenge.yml/dispatches',
      'https://api.github.com/repos/TekGadgt/cssdaily.dev/actions/workflows/backup.yml/dispatches',
    ]);
    await expect(dispatchForCron('*/5 * * * *', 'tok', fetchFn)).rejects.toThrow(/No workflow mapped/);
  });

  it('sends the documented request', async () => {
    const fetchFn = vi.fn(async () => noContent());
    await dispatchWorkflow('generate-challenge.yml', 'secret-token', fetchFn);
    const init = (fetchFn.mock.calls[0] as unknown as [string, RequestInit])[1];
    const headers = init.headers as Record<string, string>;
    expect(init.method).toBe('POST');
    expect(headers.Authorization).toBe('Bearer secret-token');
    expect(headers.Accept).toBe('application/vnd.github+json');
    expect(headers['X-GitHub-Api-Version']).toBe('2022-11-28');
    expect(headers['User-Agent']).toBeTruthy();
    expect(JSON.parse(init.body as string)).toEqual({ ref: 'main' });
  });

  it.each([401, 403, 404, 422])('throws on HTTP %i without leaking the token', async (status) => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({ message: 'nope' }), { status }));
    const err = await dispatchWorkflow('backup.yml', 'secret-token', fetchFn).catch((e: Error) => e);
    expect((err as Error).message).toMatch(new RegExp(`HTTP ${status} — nope`));
    expect((err as Error).message).not.toContain('secret-token');
  });

  it('refuses to run without a token', async () => {
    await expect(dispatchWorkflow('backup.yml', '', vi.fn())).rejects.toThrow(/GITHUB_DISPATCH_TOKEN/);
  });

  // GitHub disables a *scheduled* workflow after 60 days without repo
  // activity, and a disabled workflow can't be dispatched either — so the
  // targets must never regain a schedule.
  it.each(Object.values(CRON_WORKFLOWS))('%s has no schedule trigger', (file) => {
    const yml = fs.readFileSync(`.github/workflows/${file}`, 'utf8');
    expect(yml).not.toMatch(/^\s*schedule:/m);
  });
});
