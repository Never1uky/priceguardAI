/** Общие утилиты для Edge Functions PriceGuard AI */

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

export function handleCors(req: Request): Response | null {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  return null;
}

/** PGAI-XXXX-XXXX-XXXX или PGAI-XXXX-LIFE */
export function generateLicenseKey(plan: 'monthly' | 'yearly' | 'lifetime'): string {
  const part = () =>
    Math.random().toString(36).substring(2, 6).toUpperCase().padEnd(4, '0').slice(0, 4);
  if (plan === 'lifetime') {
    return `PGAI-${part()}-${part()}-LIFE`;
  }
  if (plan === 'yearly') {
    return `PGAI-${part()}-${part()}-YEAR`;
  }
  return `PGAI-${part()}-${part()}-${part()}`;
}

export function normalizeKey(key: string): string {
  return key.trim().toUpperCase().replace(/\s+/g, '');
}

export const PLAN_PRICES: Record<string, number> = {
  monthly: 299,
  yearly: 2490,
  lifetime: 2990,
};

export const PLAN_LABELS: Record<string, string> = {
  monthly: 'месяц',
  yearly: 'год',
  lifetime: 'навсегда',
};
