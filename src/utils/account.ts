/**
 * Browser-side calls to Better Auth's endpoints (mounted at /api/auth in
 * src/worker.ts). Plain fetch keeps the island small; same-origin, so the
 * session cookie rides along automatically.
 */
export interface SessionUser {
  name: string;
  email: string;
  image?: string | null;
}

/** Query flag set when returning from a re-authentication to finish deleting. */
export const CONFIRM_DELETE_PARAM = 'confirm-delete';

const json = { 'Content-Type': 'application/json' };

export async function getSession(fetchFn: typeof fetch = fetch): Promise<SessionUser | null> {
  try {
    const res = await fetchFn('/api/auth/get-session', { credentials: 'same-origin' });
    if (!res.ok) return null;
    const data = (await res.json()) as { user?: SessionUser } | null;
    return data?.user ?? null;
  } catch {
    return null;
  }
}

/** Current path + query, minus our own flag: where sign-in should land the player again. */
export function returnPath(loc: Pick<Location, 'pathname' | 'search'>, confirmDelete = false): string {
  const params = new URLSearchParams(loc.search);
  params.delete(CONFIRM_DELETE_PARAM);
  if (confirmDelete) params.set(CONFIRM_DELETE_PARAM, '1');
  const query = params.toString();
  return `${loc.pathname}${query ? `?${query}` : ''}`;
}

/** Starts GitHub sign-in; resolves to the GitHub URL to navigate to. */
export async function startGitHubSignIn(callbackURL: string, fetchFn: typeof fetch = fetch): Promise<string> {
  const res = await fetchFn('/api/auth/sign-in/social', {
    method: 'POST',
    credentials: 'same-origin',
    headers: json,
    body: JSON.stringify({ provider: 'github', callbackURL }),
  });
  const data = (await res.json().catch(() => null)) as { url?: string } | null;
  if (!res.ok || !data?.url) throw new Error('Sign-in could not start');
  return data.url;
}

export async function signOut(fetchFn: typeof fetch = fetch): Promise<void> {
  await fetchFn('/api/auth/sign-out', { method: 'POST', credentials: 'same-origin', headers: json, body: '{}' });
}

/**
 * 'reauth': Better Auth requires a fresh session (signed in within a day) to
 * delete an OAuth-only account — the caller sends the player through GitHub
 * again, then asks for confirmation again.
 */
export async function deleteAccount(fetchFn: typeof fetch = fetch): Promise<'deleted' | 'reauth' | 'error'> {
  try {
    const res = await fetchFn('/api/auth/delete-user', { method: 'POST', credentials: 'same-origin', headers: json, body: '{}' });
    if (res.ok) return 'deleted';
    const data = (await res.json().catch(() => null)) as { code?: string } | null;
    return data?.code === 'SESSION_EXPIRED' || data?.code === 'SESSION_NOT_FRESH' ? 'reauth' : 'error';
  } catch {
    return 'error';
  }
}
