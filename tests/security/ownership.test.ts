import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

/**
 * Stage B (docs/audits/STAGE_B_DEVICE_CLAIM.md) concluded: no code/schema
 * change, because the two properties below already make the theoretical
 * "attacker knows a device_id" scenario low-impact:
 *   1. user_id for the claim always comes from the verified JWT, never from
 *      the request body (so an attacker can't claim into someone else's
 *      *account*, only at most receive someone else's *pre-signup watchlist*
 *      into their own account).
 *   2. Every client call site sources deviceId from the browser's own
 *      getDeviceId() (crypto.randomUUID, 122 bits) — there is no UI or API
 *      path that accepts an arbitrary/typed device_id.
 * This test is a regression guard for that decision: if either property
 * stops holding, the threat model in Stage B needs to be redone.
 */
describe('security: device-claim ownership properties (Stage B decision: A — leave as-is)', () => {
  it('claim-device-tracked: user_id comes from the verified JWT, never the request body', async () => {
    const source = await fs.readFile(
      path.resolve(
        __dirname,
        '../../supabase/functions/claim-device-tracked/index.ts',
      ),
      'utf-8',
    );
    expect(source).toMatch(/requireAuthUser\(req,\s*true\)/);
    expect(source).toMatch(/p_user_id:\s*user!\.id/);
    // Must not read a user/account id out of the JSON body.
    expect(source).not.toMatch(/body\s*\.\s*(?:user_?id|userId)/);
  });

  it('claim RPC only touches tracked_products — no reviews, payments, or PII tables reachable', async () => {
    const migration = await fs.readFile(
      path.resolve(
        __dirname,
        '../../supabase/migrations/20260703120000_device_claim_realtime.sql',
      ),
      'utf-8',
    );
    const fnBody = migration.slice(
      migration.indexOf('create or replace function public.claim_tracked_products_by_device'),
    );
    expect(fnBody).toMatch(/from public\.tracked_products/);
    expect(fnBody).not.toMatch(/from public\.(payments|license_keys|product_cache|user_alert_settings)/);
  });

  it('no client code path sources deviceId from anywhere other than the browser\'s own getDeviceId()', async () => {
    const claimDevice = await fs.readFile(
      path.resolve(__dirname, '../../src/lib/supabase/claim-device.ts'),
      'utf-8',
    );
    // The optional deviceId param exists, but every real call site (verified
    // manually in Stage B) passes await getDeviceId() — this guard at least
    // confirms the module still imports and prefers the local device id
    // rather than e.g. a form field.
    expect(claimDevice).toMatch(/getDeviceId/);
  });

  it('device_id generation prefers crypto.randomUUID (high entropy)', async () => {
    // NOTE: src/lib/supabase/device-id.ts is the file actually imported by
    // claim-device.ts. There is a second, unrelated src/lib/subscription/device-id.ts
    // with an identical purpose but no fallback — drift worth reconciling
    // separately, not fixed here. This file's crypto.randomUUID() is guarded
    // by a lower-entropy Math.random()-based fallback for environments where
    // the Web Crypto API is unavailable; that fallback path is untested here
    // and is a follow-up if it's ever reachable in production (Chrome
    // extensions have crypto.randomUUID universally, so likely dead code,
    // but the assumption should be verified, not assumed).
    const deviceId = await fs.readFile(
      path.resolve(__dirname, '../../src/lib/supabase/device-id.ts'),
      'utf-8',
    );
    expect(deviceId).toMatch(/crypto\.randomUUID\(\)/);
  });
});
