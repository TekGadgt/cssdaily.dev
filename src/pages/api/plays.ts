import type { APIRoute } from 'astro';
import { MAX_PLAY_BYTES, UPSERT_PLAY_SQL, isSameOrigin, parsePlay, readLimited, utcDay } from '../../lib/plays';

export const prerender = false;

// Always 204: the client never waits on or reacts to this, and an attacker
// probing it learns nothing. Checks run cheapest-first, before any D1 write.
const done = () => new Response(null, { status: 204 });

export const POST: APIRoute = async ({ request, locals }) => {
  const env = locals.runtime.env;
  try {
    // Defense in depth alongside Astro's checkOrigin (which already 403s
    // cross-site form-type POSTs): compare against the request's own origin,
    // which is right in production and under wrangler dev's host rewriting.
    if (!isSameOrigin(request.headers.get('origin'), request.url)) return done();

    const text = await readLimited(request.body, MAX_PLAY_BYTES);
    if (text === null) return done();
    let body: unknown;
    try { body = JSON.parse(text); } catch { return done(); }
    const play = parsePlay(body);
    if (!play) return done();

    // Key used only in memory by the limiter; never stored
    const { success } = await env.PLAYS_LIMITER.limit({ key: request.headers.get('cf-connecting-ip') ?? 'unknown' });
    if (!success) return done();

    // The foreign key rejects plays for challenges that don't exist
    await env.DB.prepare(UPSERT_PLAY_SQL).bind(play.mode, play.date, play.difficulty, utcDay()).run();
  } catch (err) {
    console.error('plays: dropped', err instanceof Error ? err.message : err);
  }
  return done();
};
