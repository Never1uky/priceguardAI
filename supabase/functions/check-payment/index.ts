import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import { handleCors, jsonResponse } from '../_shared/utils.ts';

interface CheckBody {
  sessionId: string;
}

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;

  if (req.method !== 'POST') {
    return jsonResponse({ ok: false, error: 'Method not allowed' }, 405);
  }

  try {
    const body = (await req.json()) as CheckBody;
    const sessionId = (body.sessionId ?? '').trim();

    if (!sessionId) {
      return jsonResponse({ ok: false, error: 'sessionId обязателен' }, 400);
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const { data: payment, error } = await supabase
      .from('payments')
      .select('status, plan, license_key_id')
      .eq('session_id', sessionId)
      .maybeSingle();

    if (error || !payment) {
      return jsonResponse({ ok: false, error: 'Сессия не найдена' }, 404);
    }

    let licenseKey: string | undefined;

    if (payment.license_key_id) {
      const { data: license } = await supabase
        .from('license_keys')
        .select('key_code, expires_at, plan')
        .eq('id', payment.license_key_id)
        .maybeSingle();

      licenseKey = license?.key_code;

      if (license) {
        const expiresAt = license.expires_at
          ? new Date(license.expires_at).getTime()
          : undefined;

        return jsonResponse({
          ok: true,
          status: payment.status,
          licenseKey,
          plan: license.plan,
          expiresAt,
        });
      }
    }

    return jsonResponse({
      ok: true,
      status: payment.status,
      licenseKey,
      plan: payment.plan,
    });
  } catch (error) {
    console.error('check-payment:', error);
    return jsonResponse({ ok: false, error: 'Внутренняя ошибка' }, 500);
  }
});
