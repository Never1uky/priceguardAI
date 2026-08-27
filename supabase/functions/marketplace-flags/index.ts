/**
 * Public read: server marketplace feature flags for extension + ops.
 * GET (no body) → { ok, flags, source, updated_at }
 *
 * Restrictive only — safe without JWT. Does not expose secrets.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import {
  loadMarketplaceFlags,
  marketplaceFlagsPublicPayload,
} from '../_shared/marketplace-flags.ts';
import { corsHeaders, jsonResponse } from '../_shared/utils.ts';

function serviceClient() {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (req.method !== 'GET' && req.method !== 'POST') {
    return jsonResponse({ ok: false, error: 'Method not allowed' }, 405);
  }

  try {
    const loaded = await loadMarketplaceFlags(serviceClient());
    return jsonResponse({
      ok: true,
      flags: marketplaceFlagsPublicPayload(loaded),
      source: loaded.source,
      updated_at: loaded.updatedAt,
    });
  } catch (error) {
    console.error('[marketplace-flags]', error);
    return jsonResponse({ ok: false, error: 'Server error' }, 500);
  }
});
