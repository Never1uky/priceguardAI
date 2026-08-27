# Growth Brief → backlog deliverables

Audit date: 2026-08-20. Plan file not edited. Code changes limited to golden tests; no privacy/CWS/payment production edits.

| ID | Doc | Status |
|----|-----|--------|
| P0.1 | [P0.1_FUNNEL_TELEMETRY_DESIGN.md](./P0.1_FUNNEL_TELEMETRY_DESIGN.md) | Local funnel events IMPLEMENTED |
| P0.2 | [P0.2_FIRST_COMPARISON_UX.md](./P0.2_FIRST_COMPARISON_UX.md) | UX DONE (CTA + progress n/3) |
| P0.3 | [P0.3_PRIVACY_CLAIMED_VS_ACTUAL.md](./P0.3_PRIVACY_CLAIMED_VS_ACTUAL.md) | REVALIDATED after P0.1 funnel (audit DONE) |
| P0.4 | [P0.4_FREE_PREMIUM_CLARITY.md](./P0.4_FREE_PREMIUM_CLARITY.md) | Clarity audit; CWS copy drift noted |
| P0.5 | [P0.5_CWS_RELEASE_CHECKLIST.md](./P0.5_CWS_RELEASE_CHECKLIST.md) | Checklist; upload MANUAL |
| P1.1 | `src/lib/growth-category-golden.test.ts` | Golden + iPhone base≠Pro≠Pro Max tier gate DONE |
| P1.2–4 | [P1_SEO_INDEXING_AND_OFFERS.md](./P1_SEO_INDEXING_AND_OFFERS.md) | P1.2 audited · P1.3 UI DONE · offers 6/6 real SKU (2 PASS 2MP, 4 WEAK YM-only) · cron active · P1.4 MANUAL |
| P1.5 | See § Telegram below | AlertsBot MVP ALREADY IMPLEMENTED |

## Telegram (P1.5) — short audit

- **AlertsBot** (`telegram-webhook`): product URL → `runProductIntel` → card; compare from cache/mapping (not live SERP).  
- **SupportBot**: help / Premium / feedback.  
- **MVP rewrite:** not needed.  
- **MANUAL:** smoke «Сервер Вкл» + send WB URL in `@PriceGuardAlertsBot`.

## First actions for owner

1. ~~Залить 0.9.95 в CWS по чеклисту P0.5.~~ Done (owner).  
2. ~~Live smoke из P0.2.~~ Done (owner).  
3. ~~P0.1 funnel events (local-only).~~ Done (AGENT).  
4. GSC / Яндекс.Вебмастер: submit SEO sitemap + URL Inspection (MANUAL) — см. P1.4.  
5. CWS listing: fix Premium «unlimited tracking» → «до 50 товаров» (MANUAL) — см. P0.4.

## Do not do now

Mass SEO pages · PostHog · Telegram rewrite · live Scrappey on SEO SSR · remote telemetry default-on · YooKassa changes.
