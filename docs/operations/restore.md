# Restoring challenge data

Challenge data lives in Cloudflare D1 (`cssdaily`), and target images in R2 (`cssdaily-assets`, served at `assets.cssdaily.dev`). Pick the lightest option that fixes the problem.

## 1. Recent mistake in D1: Time Travel

D1 keeps point-in-time history: 7 days on the Workers Free plan, 30 on Paid.

```bash
npx wrangler d1 time-travel info cssdaily --remote               # current bookmark
npx wrangler d1 time-travel restore cssdaily --remote --timestamp=<RFC3339 or unix>
```

Then redeploy so the site rebuilds from the restored data: `gh workflow run deploy.yml --ref main`.

## 2. Older than Time Travel: weekly export

The private bucket `cssdaily-backups` holds:

- `d1/<YYYY-MM-DD>.sql`: full D1 exports (the newest 12 are kept);
- `manifests/<YYYY-MM-DD>.json`: row count, the export's MD5, and the MD5 of every image;
- `targets/<mode>/<file>`: every target image ever published (never pruned).

Each backup run has already loaded its export into a throwaway local database and checked the row count, so a stored export is known to restore.

1. Download the export, using the **backup** bucket's credentials. The R2 dashboard (bucket → object → Download) is simplest.
2. Check it: compare `md5 -q <file>` with `d1.md5` in that date's manifest.
3. Optionally rehearse locally: `npx wrangler d1 execute cssdaily --local --persist-to .restore-test --file <file>`. Then delete `.restore-test`.
4. Restore into production. This **replaces** the data, so be sure first:
   ```bash
   npx wrangler d1 execute cssdaily --remote --command "DROP TABLE challenges"
   npx wrangler d1 execute cssdaily --remote --file <file>
   ```
   The export recreates the table and its rows. If it also contains `d1_migrations`, drop that table first too.
5. Redeploy: `gh workflow run deploy.yml --ref main`.

## 3. A target image is missing or wrong in `cssdaily-assets`

Copy it back from `cssdaily-backups/targets/<mode>/<file>`. Its MD5 must match that image's entry in the latest manifest. Published images are content-addressed and never change, so the backup copy is exactly what the site expects.

## 4. Abandoning D1/R2 entirely (Phase 2 rollback)

`npm run data:pull -- --require-d1 --layout repo --with-images` writes everything back to the old repo layout: `src/data/{challenges,tailwind-challenges}/` and `public/targets/`, with images checksum-verified. For the full procedure, see Task 9 of `docs/superpowers/plans/2026-11-11-challenge-data-to-d1-and-r2.md`.
