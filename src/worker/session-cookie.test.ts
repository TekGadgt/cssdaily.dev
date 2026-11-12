import { describe, expect, it } from 'vitest';
import { hasSessionCookie } from './session-cookie';

describe('hasSessionCookie', () => {
  it.each([
    'better-auth.session_token=abc.def',
    '__Secure-better-auth.session_token=abc.def',
    'theme=dark; __Secure-better-auth.session_token=abc',
    'better-auth-session_token=abc',
  ])('recognizes %s', (cookie) => expect(hasSessionCookie(cookie)).toBe(true));

  it.each([
    null,
    '',
    'theme=dark',
    'better-auth.state=xyz',
    'better-auth.session_data=xyz',
    'better-auth.session_token=',
    'notbetter-auth.session_token=abc',
  ])('rejects %s', (cookie) => expect(hasSessionCookie(cookie)).toBe(false));
});
