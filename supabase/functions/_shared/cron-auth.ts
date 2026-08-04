/**
 * Shared cron / service authorization for Edge Functions.
 * Accepts x-cron-secret === UPDATE_PRICES_CRON_SECRET OR Bearer service_role.
 */

export type CronAuthReason =
  | 'ok_cron_secret'
  | 'ok_service_role'
  | 'missing_both_credentials'
  | 'invalid_cron_secret'
  | 'invalid_service_role'
  | 'missing_server_config';

export interface CronAuthResult {
  ok: boolean;
  reason: CronAuthReason;
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
