# Phase 3 — Store config

## Verdict

**Yes — add a centralized store config**, but **only as metadata**, not as a second build.

| Do now | Do later | Never |
|--------|----------|--------|
| `STORE_CONFIG` with **chrome filled**, **edge/yandex = null** | Fill Edge/Yandex after real publish IDs | Fake IDs / fake URLs |
| Keep CTAs on **primary = chrome** | SEO multi-`extensionId` using `listKnownExtensionIds()` | Point Telegram buttons at `null` |
| Keep `CHROME_WEB_STORE_*` exports (compat) | Soften “Chrome Web Store” copy | Fork dist per store |

Implemented in this phase (behavior-preserving):

- `src/lib/store-config.ts` — source of truth in the extension
- `src/lib/chrome-store.ts` — thin wrapper → primary install/review (= CWS)
- `src/lib/store-config.test.ts`
- Sync comment on Deno `telegram.ts` (values unchanged)

---

## Where config is needed

| Consumer | Repo / file | Needs | Safe with null Edge/Yandex? |
|----------|-------------|-------|------------------------------|
| Review button | `SettingsTab.tsx` → `CHROME_WEB_STORE_REVIEWS_URL` | `reviewUrl` | Yes — use primary helper |
| Options link | `src/options/index.html` (hardcoded) | `storeUrl` | Yes — still CWS until edited |
| Telegram install/review | `_shared/telegram.ts`, `alerts-faq.ts`, `support-bot.ts`, `telegram-webhook` | `storeUrl` / `reviewUrl` | **Must stay real CWS** — do not wire null |
| SEO CTA bridge | `priceguard-seo` `config.ts` + `compare-cta.tsx` | **`extensionId[]`** + install URL | Yes — try only known IDs; fallback install = CWS |
| Landing install | `priceguard-landing` `site.ts` | `storeUrl` | Yes — keep CWS |
| Landing deep link | `PaymentSuccessPage` `chrome-extension://${id}/…` | **real** `extensionId` | **Unsafe** with null — keep CWS ID only |
| Telemetry | optional future | channel label | N/A |
| Docs / listings | `CHROME_WEB_STORE_LISTING.md` etc. | human copy | N/A |

**Not needed for:** marketplace logic, matching, AI, Scrappey, Premium, Supabase schema, MV3 permissions, `package:zip` artifact shape.

---

## Recommended shape

```ts
STORE_CONFIG = {
  chrome: { storeUrl, extensionId, reviewUrl },  // real
  edge:   { storeUrl: null, extensionId: null, reviewUrl: null },
  yandex: { storeUrl: null, extensionId: null, reviewUrl: null },
}
PRIMARY_STORE_CHANNEL = 'chrome'
getPrimaryInstallUrl() / getPrimaryReviewUrl()  // never null
listKnownExtensionIds()  // ['ipaichogg…'] today
```

Helpers that **throw or skip** if null — never send `sendMessage(null)` or `href={null}`.

---

## Cross-repo note (do not “fix” blindly)

Extension `store-config.ts` **cannot** be imported by:

- Deno Edge Functions (duplicate + comment — already)
- `priceguard-seo` / `priceguard-landing` (separate apps)

When Edge/Yandex IDs exist, update in order:

1. `src/lib/store-config.ts`
2. `supabase/functions/_shared/telegram.ts` (and bot copy if multi-link)
3. `priceguard-seo` `SITE` + multi-ID `sendMessage` loop (**CWS id first**)
4. `priceguard-landing` `SITE` (install links; payment deep link stays CWS or becomes browser-detect)

---

## CWS regression risk

| Change | Risk |
|--------|------|
| store-config + chrome-store wrapper | **Low** — same URLs via helpers |
| Tests | None |
| Telegram values | **Unchanged** |
| SEO / landing | **Unchanged** this phase |
| options.html still hardcoded | Still matches CWS — optional later to generate from config |

---

## What was not done (intentionally)

- No Edge/Yandex URLs or IDs
- No Telegram button multi-store UI
- No SEO multi-ID loop (needs real IDs + seo repo)
- No `dist-edge` / build forks
- No permission / manifest changes
