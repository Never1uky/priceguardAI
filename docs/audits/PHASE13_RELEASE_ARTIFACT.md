# Phase 13 — Release artifact

## Layout

```
release/0.9.107/
  priceguard-ai-v0.9.107.zip   # single binary (from Phase 9 fresh build)
  SHA256.txt
  RELEASE_NOTES.md
  EDGE_UPLOAD.md
  YANDEX_UPLOAD.md
  QA_CHECKLIST.md
```

- **One zip** — not three dist copies.  
- `.gitignore` updated so root `priceguard-ai-v*.zip` stay ignored; `release/` can be tracked.  
- Hash: `33ad9e20784007a75d5bd7c8cdeb0a32b3716a457c77f43f0b14a7793ec2859d`

## Compatibility note

Ship the same zip to CWS + Edge after QA. Yandex users typically install that CWS package inside Яндекс.Браузер (`YANDEX_UPLOAD.md`).
