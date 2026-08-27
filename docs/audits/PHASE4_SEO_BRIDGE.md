# Phase 4 — SEO bridge (multi-store extension IDs)

## Problem

`chrome.runtime.sendMessage(extensionId, …)` needs a **concrete** ID.  
CWS = `ipaichogganccpnapdgkjldplllnjlpf`. Edge / Yandex will get **different** IDs.  
SEO site (`priceguard-seo.vercel.app`) must open compare in whichever store build the user installed.

## Options

| | Approach | Pros | Cons |
|--|----------|------|------|
| **A** | Allowlist of published IDs | Explicit, no UA hacks | Alone doesn’t send — need a try strategy |
| **B** | Browser UA → pick one ID | One sendMessage | Fragile (Yandex≈Chrome); wrong if user has other store’s extension; fails if detection ≠ installed |
| **C** | Try sendMessage to several IDs | Works with whatever is installed | Few no-op failures if multiple IDs listed |
| **D** | Custom protocol / native host | No store ID | Heavy; App Store issues; overkill |

## Choice: **A + C** (allowlist + try in order)

1. Config holds **only real** IDs (`extensionIds[]`).  
2. On CTA: try each ID **sequentially** until `response.ok === true`.  
3. Order: **Chrome first**, then Edge, then Yandex (when filled).  
4. All fail → install fallback (`chromeStoreUrl` / primary).  

Not B: UA ≠ “which extension is installed”.  
Not D: unnecessary complexity.

Today the list is **only CWS** — behavior identical to before. After Edge/Yandex publish, append IDs (no fake values).

## Implemented (minimal)

**Repo `priceguard-seo`:**

- `src/lib/config.ts` — `extensionIds: [cwsId]`, `knownExtensionIds()`, keep deprecated `extensionId`
- `src/lib/extension-bridge.ts` — `tryOpenInExtension` loop
- `src/lib/extension-bridge.test.ts`
- `src/components/compare-cta.tsx` — uses bridge helper

**Repo `priceguard-ai`:** extension `externally_connectable` unchanged (same origin for all store builds). Sync note in this doc ↔ `store-config.ts`.

## After Edge/Yandex IDs exist

```ts
extensionIds: [
  'ipaichogganccpnapdgkjldplllnjlpf', // chrome
  '<edge-id>',
  '<yandex-id>',
],
```

Also fill `priceguard-ai` `STORE_CONFIG.edge/yandex.extensionId`. Redeploy SEO.

## CWS regression

| Risk | Mitigation |
|------|------------|
| CWS still first in list | Yes |
| Single-ID path unchanged until more IDs added | Yes |
| Fake IDs | None |

## Manual test

1. CWS extension installed → SEO CTA opens compare.  
2. No extension → install link.  
3. Later: Edge-only install → CTA hits Edge ID after CWS attempt fails.
