/**
 * Metrics dashboard access control. Deliberately dependency-free (no
 * createClient / esm.sh import) so it can be unit-tested directly, unlike
 * the rest of auth.ts which needs a live Supabase client.
 *
 * Fail-closed by design: if METRICS_ADMIN_EMAILS is unset, empty, or
 * malformed (no parseable emails), access is DENIED to everyone, never
 * granted to "any authenticated user".
 */
export function canAccessMetrics(email: string | undefined): boolean {
  const list = (Deno.env.get('METRICS_ADMIN_EMAILS') ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  if (list.length === 0) return false;
  if (!email) return false;
  return list.includes(email.toLowerCase());
}
