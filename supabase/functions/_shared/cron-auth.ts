/**
 * Shared cron / service authorization for Edge Functions.
 * Accepts x-cron-secret === UPDATE_PRICES_CRON_SECRET OR Bearer service credentials.
 *
 * Service auth accepts:
 * 1) Exact Bearer match with SUPABASE_SERVICE_ROLE_KEY (JWT or sb_secret)
 * 2) Legacy JWT Bearer with payload.role === 'service_role' and ref matching project
 *    (needed when Edge env has sb_secret while callers still use legacy service_role JWT)
 */

export type CronAuthReason =
  | 'ok_cron_secret'
  | 'ok_service_role'
  | 'ok_service_role_jwt'
  | 'missing_both_credentials'
  | 'invalid_cron_secret'
  | 'invalid_service_role'
  | 'missing_server_config';

export interface CronAuthResult {
  ok: boolean;
  reason: CronAuthReason;
}

function projectRefFromEnv(): string | null {
  const url = Deno.env.get('SUPABASE_URL')?.trim();
  if (!url) return null;
  try {
    const host = new URL(url).hostname; // {ref}.supabase.co
    const ref = host.split('.')[0]?.trim();
    return ref || null;
  } catch {
    return null;
  }
}

/** Decode JWT payload without verifying signature (role/ref gate only). */
export function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const pad = b64.length % 4 === 0 ? '' : '='.repeat(4 - (b64.length % 4));
    const json = atob(b64 + pad);
    const obj = JSON.parse(json);
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;
    return obj as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function isLegacyServiceRoleJwt(
  authHeader: string,
  expectedRef: string | null,
): boolean {
  const m = /^Bearer\s+(\S+)$/i.exec(authHeader.trim());
  if (!m) return false;
  const payload = decodeJwtPayload(m[1]);
  if (!payload) return false;
  if (payload.role !== 'service_role') return false;
  if (expectedRef && payload.ref != null && String(payload.ref) !== expectedRef) {
    return false;
  }
  return true;
}

export function authorizeCronOrServiceRoleDetailed(req: Request): CronAuthResult {
  const cronSecret = Deno.env.get('UPDATE_PRICES_CRON_SECRET')?.trim();
  const headerSecret = req.headers.get('x-cron-secret')?.trim();
  if (cronSecret && headerSecret && headerSecret === cronSecret) {
    return { ok: true, reason: 'ok_cron_secret' };
  }

  const auth = req.headers.get('Authorization') ?? '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')?.trim();
  if (serviceKey && auth === `Bearer ${serviceKey}`) {
    return { ok: true, reason: 'ok_service_role' };
  }

  // Legacy service_role JWT while Edge holds sb_secret (or rotated key mismatch).
  if (auth && isLegacyServiceRoleJwt(auth, projectRefFromEnv())) {
    return { ok: true, reason: 'ok_service_role_jwt' };
  }

  if (!cronSecret && !serviceKey) {
    return { ok: false, reason: 'missing_server_config' };
  }
  if (!headerSecret && !auth) {
    return { ok: false, reason: 'missing_both_credentials' };
  }
  if (headerSecret && cronSecret && headerSecret !== cronSecret) {
    return { ok: false, reason: 'invalid_cron_secret' };
  }
  if (auth && serviceKey && auth !== `Bearer ${serviceKey}`) {
    return { ok: false, reason: 'invalid_service_role' };
  }
  return { ok: false, reason: 'missing_server_config' };
}

export function authorizeCronOrServiceRole(req: Request): boolean {
  return authorizeCronOrServiceRoleDetailed(req).ok;
}
