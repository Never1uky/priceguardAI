# Matching P2 Runbook

## Scope

P2 adds safe rule-pack overlays, weak-label feedback bias, and optional threshold calibration for compare matching.
LLM is still disabled in compare path by default.

## Feature Flags

- `enableRemoteRulePack` (default: `false`)
- `enableFeedbackBias` (default: `false`)
- `enableCalibratedThresholds` (default: `false`)

Flags are resolved through `resolveMatchFeatureFlags()` in `src/lib/match-flags.ts`.

## Rollout Plan

1. Enable only `enableRemoteRulePack` for a small cohort.
2. Enable `enableFeedbackBias` next, with strict capped bias (`-0.08..+0.06`) and reject blocking.
3. Enable `enableCalibratedThresholds` after verifying metrics drift is safe.

## Rollback

- Set all three flags to `false`.
- Runtime falls back to bundled match rules automatically.
- Invalid/old/failed remote payloads are fail-closed and stay on bundled rules.

## Metrics to Watch

- False auto-pick rate (must not increase)
- Precision@verified (must not decrease)
- Needs-choice rate drift (watch for sharp spikes)
- Remote rule source telemetry (`source=remote|bundled`, `reason=*`)

## Guardrails

- Hard conflicts (role, lineage, storage, connector, condition, authenticity, region, edition, quantity) are never bypassed by history/feedback boosts.
- Price/rating/history are ranking tie-breakers only among hard-compatible candidates.
