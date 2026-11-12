// Better Auth's session cookie, as it reads it: better-auth.session_token
// (or better-auth-session_token), with a __Secure- prefix over HTTPS.
const SESSION_COOKIE = /(?:^|;\s*)(?:__Secure-)?better-auth[.-]session_token=[^;\s]/;

/** True when the request could belong to a signed-in player. */
export const hasSessionCookie = (cookieHeader: string | null): boolean =>
  !!cookieHeader && SESSION_COOKIE.test(cookieHeader);
