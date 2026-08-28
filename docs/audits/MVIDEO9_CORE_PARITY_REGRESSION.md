# MVIDEO-9 — CORE-parity regression pack (READY)

**Date:** 2026-08-28  
**Verdict:** **READY** — matrix gate + sibling tests green; `MVIDEO_FULL_INTEGRATION_NO_TELEGRAM.md` updated.

## Deliverables

| Item | Path |
|------|------|
| Matrix regression | `src/lib/mvideo-core-parity.regression.test.ts` |
| npm script | `npm run test:mvideo` in `package.json` |
| Integration doc | `docs/audits/MVIDEO_FULL_INTEGRATION_NO_TELEGRAM.md` → READY |

## Run

```bash
npm run test:mvideo
```

**2026-08-28:** 15 files, **143** tests passed.

## Matrix coverage

- Card: mvideo.ru + eldorado.ru detect/canonical; dedicated parser (not generic)
- Registry: default-on, reviews false, costTier tab
- Compare/research: VALID ∩ selected; Premium unlocker allowlist
- Track: `mv-{article}` identity
- Refresh: client-owned when CORE cron on
- Cache: shared `price_scrape_cache` (MVIDEO-4 sibling test)
- Reviews: SKIP (MVIDEO-7)
- SEO: publishAllowed + gates block thin analysis
- OUT OF SCOPE: Telegram skip; no cron monitoring

## OUT OF SCOPE (unchanged)

Telegram detect/alerts, `monitoring_enabled`, `update-prices` cron for mvideo.
