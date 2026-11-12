import { describe, expect, it, vi } from 'vitest';
import { USER_AGENT, withGitHubUserAgent } from './github-user-agent';

const capture = () => {
  const seen: Request[] = [];
  const base = vi.fn(async (req: Request) => { seen.push(req); return new Response('ok'); });
  return { seen, wrapped: withGitHubUserAgent(base as unknown as typeof fetch) };
};

describe('withGitHubUserAgent', () => {
  it('adds a User-Agent to the GitHub token exchange, keeping method and body', async () => {
    const { seen, wrapped } = capture();
    await wrapped('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' },
      body: 'code=abc&client_id=x',
    });
    expect(seen[0].headers.get('user-agent')).toBe(USER_AGENT);
    expect(seen[0].headers.get('accept')).toBe('application/json');
    expect(seen[0].method).toBe('POST');
    expect(await seen[0].text()).toBe('code=abc&client_id=x');
  });

  it('never overwrites an existing User-Agent', async () => {
    const { seen, wrapped } = capture();
    await wrapped('https://api.github.com/user', { headers: { 'User-Agent': 'better-auth' } });
    expect(seen[0].headers.get('user-agent')).toBe('better-auth');
  });

  it('leaves other hosts alone', async () => {
    const { seen, wrapped } = capture();
    await wrapped('https://api.cloudflare.com/client/v4/x');
    expect(seen[0].headers.has('user-agent')).toBe(false);
  });
});
