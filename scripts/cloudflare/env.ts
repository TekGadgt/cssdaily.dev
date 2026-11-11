/**
 * Environment access for the Cloudflare scripts. A blank or whitespace-only
 * value counts as unset: a copied `.env.example` (all blanks) must behave
 * exactly like no `.env`, and an empty variable must never shadow a real
 * fallback (e.g. a blank D1_WRITE_TOKEN hiding a populated D1_READ_TOKEN).
 */
export function readEnv(name: string, env: NodeJS.ProcessEnv = process.env): string | undefined {
  const value = env[name]?.trim();
  return value ? value : undefined;
}

export function requireEnv(name: string, env: NodeJS.ProcessEnv = process.env): string {
  const value = readEnv(name, env);
  if (!value) throw new Error(`${name} is required (set it in .env locally, or as a CI secret/variable)`);
  return value;
}
