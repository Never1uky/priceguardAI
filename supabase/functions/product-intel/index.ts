// Shared Product Intelligence API (extension + Telegram).
// POST { action: 'analyze' | 'lookup', url? | marketplace + productId, allowGenerate?, reviews? }

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import { corsHeaders, jsonResponse } from '../_shared/utils.ts';
import { parseProductLinkFromText } from '../_shared/product-url.ts';
import {
  loadAnalysisForKey,
  runProductIntel,
} from '../_shared/product-intel.ts';
import { stripProductIdPrefix } from '../_shared/product-id.ts';
import { requireAuthUser } from '../_shared/auth.ts';
import type { Marketplace } from '../_shared/product-url.ts';

function serviceClient() {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );
}

async function isPremiumUser(
  supabase: ReturnType<typeof serviceClient>,
  userId: string,
): Promise<boolean> {
  const { data } = await supabase
    .from('user_premium')
    .select('expires_at')
    .eq('user_id', userId)
    .maybeSingle();
  if (!data) return false;
  return !data.expires_at || new Date(data.expires_at) > new Date();
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return jsonResponse({ ok: false, error: 'Method not allowed' }, 405);
  }

  try {
    const body = await req.json();
    const action = String(body.action ?? 'analyze');
    const supabase = serviceClient();
    const authUser = await requireAuthUser(req, false);

    if (action === 'lookup') {
      const marketplace = String(body.marketplace ?? '') as Marketplace;
      const productId = String(body.productId ?? '');
      if (!marketplace || !productId) {
        return jsonResponse({ ok: false, error: 'marketplace + productId required' }, 400);
      }
      const analysis = await loadAnalysisForKey(supabase, marketplace, productId);
      return jsonResponse({
        ok: true,
        analysis,
        fromCache: Boolean(analysis),
      });
    }

    if (action === 'analyze') {
      const urlText = String(body.url ?? body.text ?? '');
      let parsed = urlText ? parseProductLinkFromText(urlText) : null;
      if (!parsed && body.marketplace && body.productId) {
        const marketplace = String(body.marketplace) as Marketplace;
        const productId = stripProductIdPrefix(marketplace, String(body.productId));
        parsed = {
          marketplace,
          productId,
          url: String(body.productUrl ?? ''),
          titleHint: body.titleHint ? String(body.titleHint) : undefined,
        };
        if (!parsed.url) {
          return jsonResponse({ ok: false, error: 'productUrl or url required' }, 400);
        }
      }
      if (!parsed) {
        return jsonResponse({ ok: false, error: 'url required' }, 400);
      }

      const userId =
        (body.userId ? String(body.userId) : null) ||
        authUser?.id ||
        null;
      const premium = body.isPremium != null
        ? Boolean(body.isPremium)
        : userId
          ? await isPremiumUser(supabase, userId)
          : false;

      const reviews = Array.isArray(body.reviews)
        ? body.reviews.map((r: unknown) => String(r))
        : undefined;

      const card = await runProductIntel({
        supabase,
        parsed,
        chatId: body.chatId ? String(body.chatId) : undefined,
        userId,
        isPremium: premium,
        allowGenerate: body.allowGenerate !== false,
        reviews,
      });

      return jsonResponse({ ok: true, card });
    }

    return jsonResponse({ ok: false, error: 'Unknown action' }, 400);
  } catch (error) {
    console.error('[product-intel]', error);
    return jsonResponse({
      ok: false,
      error: error instanceof Error ? error.message : 'Server error',
    }, 500);
  }
});
