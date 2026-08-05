import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import { bindLicenseToUser } from '../_shared/license-bind.ts';
import { generateLicenseKey, handleCors, jsonResponse, PLAN_PRICES } from '../_shared/utils.ts';
import { fetchYookassaPayment } from '../_shared/yookassa-verify.ts';

async function bindPaymentUserPremium(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  paymentRow: { user_id?: string | null },
  license: { id: string; plan: string; expires_at: string | null },
) {
  if (!paymentRow.user_id) return;
  const result = await bindLicenseToUser(supabase, paymentRow.user_id, {
    id: license.id,
    plan: license.plan,
    expires_at: license.expires_at,
  });
  if (result.ok === false) {
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
    const paymentHint = body?.object;

    if (event !== 'payment.succeeded' && event !== 'payment.canceled') {
      return jsonResponse({ ok: true, skipped: true });
    }

    const yookassaId = paymentHint?.id as string | undefined;
    if (!yookassaId) {
      return jsonResponse({ ok: false, error: 'payment id required' }, 400);
    }

    // Never trust webhook body — re-fetch from YooKassa API
    const verified = await fetchYookassaPayment(yookassaId);
    if (!verified) {
      return jsonResponse({ ok: false, error: 'Payment verification failed' }, 502);
    }

    const sessionId = verified.sessionId;
    if (!sessionId) {
      return jsonResponse({ ok: false, error: 'No session metadata' }, 400);
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const { data: paymentRow, error: fetchError } = await supabase
      .from('payments')
      .select('*')
      .eq('session_id', sessionId)
      .maybeSingle();

    if (fetchError || !paymentRow) {
      console.error('payment not found:', sessionId, yookassaId);
      return jsonResponse({ ok: false, error: 'Payment not found' }, 404);
    }

    // Bind yookassa id if missing
    if (!paymentRow.yookassa_payment_id) {
      await supabase
        .from('payments')
        .update({ yookassa_payment_id: verified.id })
        .eq('id', paymentRow.id);
    } else if (paymentRow.yookassa_payment_id !== verified.id) {
      console.error('[yookassa-webhook] payment id mismatch');
      return jsonResponse({ ok: false, error: 'Payment id mismatch' }, 400);
    }

    if (event === 'payment.canceled') {
      if (verified.status !== 'canceled') {
        return jsonResponse({ ok: false, error: 'Not canceled at YooKassa' }, 400);
      }
      await supabase
        .from('payments')
        .update({ status: 'canceled' })
        .eq('id', paymentRow.id);
      return jsonResponse({ ok: true });
    }

    // payment.succeeded
    if (verified.status !== 'succeeded') {
      return jsonResponse({ ok: false, error: 'Not succeeded at YooKassa' }, 400);
    }

    if (verified.currency !== 'RUB') {
      return jsonResponse({ ok: false, error: 'Unexpected currency' }, 400);
    }

    const expectedRub = Number(paymentRow.amount_rub);
    const planPrice = PLAN_PRICES[paymentRow.plan as string];
    if (
      !Number.isFinite(verified.amountValue) ||
      Math.round(verified.amountValue) !== Math.round(expectedRub) ||
      (typeof planPrice === 'number' && Math.round(verified.amountValue) !== planPrice)
    ) {
      console.error('[yookassa-webhook] amount mismatch', {
        verified: verified.amountValue,
        expected: expectedRub,
        plan: paymentRow.plan,
      });
      return jsonResponse({ ok: false, error: 'Amount mismatch' }, 400);
    }

    if (paymentRow.status === 'succeeded' && paymentRow.license_key_id) {
      const { data: existingKey } = await supabase
        .from('license_keys')
        .select('id, plan, expires_at')
        .eq('id', paymentRow.license_key_id)
        .maybeSingle();

      if (existingKey) {
        await bindPaymentUserPremium(supabase, paymentRow, {
          id: existingKey.id,
          plan: existingKey.plan,
          expires_at: existingKey.expires_at,
        });
      }

      return jsonResponse({ ok: true, alreadyProcessed: true });
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
      .select('id, plan, expires_at')
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
        yookassa_payment_id: verified.id,
      })
      .eq('id', paymentRow.id);

    await bindPaymentUserPremium(supabase, paymentRow, {
      id: license.id,
      plan: license.plan,
      expires_at: license.expires_at,
    });

    console.info(
      `[yookassa-webhook] License issued for payment ${paymentRow.id} session ${paymentRow.session_id}`,
    );

    return jsonResponse({ ok: true });
  } catch (error) {
    console.error('yookassa-webhook:', error);
    return jsonResponse({ ok: false, error: 'Webhook error' }, 500);
  }
});
