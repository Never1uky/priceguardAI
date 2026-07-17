import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import { bindLicenseToUser } from '../_shared/license-bind.ts';
import { generateLicenseKey, handleCors, jsonResponse } from '../_shared/utils.ts';

async function bindPaymentUserPremium(
  supabase: ReturnType<typeof createClient>,
  paymentRow: { user_id?: string | null },
  license: { id: string; plan: string; expires_at: string | null },
) {
  if (!paymentRow.user_id) return;
  const result = await bindLicenseToUser(supabase, paymentRow.user_id, {
    id: license.id,
    plan: license.plan,
    expires_at: license.expires_at,
  });
  if (!result.ok) {
    console.warn('[yookassa-webhook] bind skipped:', result.error);
  }
}

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;

  if (req.method !== 'POST') {
    return jsonResponse({ ok: false, error: 'Method not allowed' }, 405);
  }

  try {
    const body = await req.json();
    const event = body?.event;
    const payment = body?.object;

    if (event !== 'payment.succeeded' && event !== 'payment.canceled') {
      return jsonResponse({ ok: true, skipped: true });
    }

    const sessionId = payment?.metadata?.session_id as string | undefined;
    const yookassaId = payment?.id as string | undefined;

    if (!sessionId && !yookassaId) {
      return jsonResponse({ ok: false, error: 'No session metadata' }, 400);
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    let query = supabase.from('payments').select('*');
    if (sessionId) {
      query = query.eq('session_id', sessionId);
    } else {
      query = query.eq('yookassa_payment_id', yookassaId!);
    }

    const { data: paymentRow, error: fetchError } = await query.maybeSingle();

    if (fetchError || !paymentRow) {
      console.error('payment not found:', sessionId, yookassaId);
      return jsonResponse({ ok: false, error: 'Payment not found' }, 404);
    }

    if (event === 'payment.canceled') {
      await supabase
        .from('payments')
        .update({ status: 'canceled' })
        .eq('id', paymentRow.id);
      return jsonResponse({ ok: true });
    }

    if (paymentRow.status === 'succeeded' && paymentRow.license_key_id) {
      const { data: existingKey } = await supabase
        .from('license_keys')
        .select('id, key_code, plan, expires_at')
        .eq('id', paymentRow.license_key_id)
        .maybeSingle();

      if (existingKey) {
        await bindPaymentUserPremium(supabase, paymentRow, {
          id: existingKey.id,
          plan: existingKey.plan,
          expires_at: existingKey.expires_at,
        });
      }

      return jsonResponse({ ok: true, licenseKey: existingKey?.key_code, alreadyProcessed: true });
    }

    const plan = paymentRow.plan as 'monthly' | 'yearly' | 'lifetime';
    const keyCode = generateLicenseKey(plan);
    const expiresAt =
      plan === 'monthly'
        ? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
        : plan === 'yearly'
          ? new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString()
          : null;

    const { data: license, error: licenseError } = await supabase
      .from('license_keys')
      .insert({
        key_code: keyCode,
        plan,
        expires_at: expiresAt,
        max_activations: plan === 'lifetime' ? 3 : 2,
        payment_id: paymentRow.id,
        is_demo: false,
      })
      .select('id, key_code, plan, expires_at')
      .single();

    if (licenseError || !license) {
      console.error('license create:', licenseError);
      return jsonResponse({ ok: false, error: 'License creation failed' }, 500);
    }

    await supabase
      .from('payments')
      .update({
        status: 'succeeded',
        paid_at: new Date().toISOString(),
        license_key_id: license.id,
      })
      .eq('id', paymentRow.id);

    await bindPaymentUserPremium(supabase, paymentRow, {
      id: license.id,
      plan: license.plan,
      expires_at: license.expires_at,
    });

    console.info(`License issued: ${license.key_code} for session ${paymentRow.session_id}`);

    return jsonResponse({ ok: true, licenseKey: license.key_code });
  } catch (error) {
    console.error('yookassa-webhook:', error);
    return jsonResponse({ ok: false, error: 'Webhook error' }, 500);
  }
});
