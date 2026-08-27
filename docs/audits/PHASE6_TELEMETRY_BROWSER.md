# Phase 6 — Telemetry browser label (Yandex)

## Why useful

Multi-store rollout needs to see **which browser** hosts the extension (Chrome vs Edge vs Yandex) for SW/content-script smoke and support — without new events or PII.

`browser` is **already** on every telemetry event (`log.ts` / `export.ts`). No new fields; fix classification only.

## Real User-Agent (Yandex Browser)

Desktop (Windows/macOS) example:

```
Mozilla/5.0 (…) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 YaBrowser/26.6.0.1845 Yowser/2.5 Safari/537.36
```

| Token | Role |
|-------|------|
| `Chrome/…` | Chromium engine — **also present in Yandex/Edge** |
| `YaBrowser/…` | **Reliable** Yandex Browser marker (desktop + mobile) |
| `Yowser/…` | Common on desktop Yandex |
| `Edg/…` | Microsoft Edge (check **before** Chrome) |

Detecting only `Chrome/` mislabels Yandex as Chrome.

## Safe approach

1. Parse UA **only in memory** → enum `chrome | edge | yandex | unknown`.  
2. **Never** send/store raw UA, OS version strings, or full Client Hints.  
3. Order: `Edg/` → `YaBrowser|Yowser` → `Chrome|Chromium` → `unknown`.  
4. Do **not** add `YaSearchBrowser` as a separate product label (search app ≠ desktop extension host); optional future if mobile extension appears.

## Implemented

- `src/lib/browser-label.ts` — shared detector  
- `getBrowserLabel()` → `BrowserLabel` (dropped former `chromium` → `unknown`)  
- `store-config.detectStoreChannelFromUa` uses same detector (unknown → chrome for URL fallback)  
- Tests with real-shaped Yandex UA  

## Privacy

| Collect | Not collect |
|---------|-------------|
| Enum browser label (existing field) | Raw UA, CH headers, device model, IP extras |

## Events

Unchanged names/schemas. Existing `browser` values may shift: Yandex users `chrome`→`yandex`; rare `chromium`→`unknown`.
