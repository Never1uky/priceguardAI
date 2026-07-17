import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import { requireAuthUser } from '../_shared/auth.ts';
import { handleCors, jsonResponse, PLAN_LABELS, PLAN_PRICES } from '../_shared/utils.ts';

type PaidPlan = 'monthly' | 'yearly' | 'lifetime';

interface CreatePaymentBody {
  plan: PaidPlan;
  returnUrl?: string;
  customerEmail?: string;
}

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;

  if (req.method !== 'POST') {
    return jsonResponse({ ok: false, error: 'Method not allowed' }, 405);
  }

  try {
    // Checkout привязывает ключ к аккаунту — JWT обязателен
    let userId: string;
    let authEmail: string | undefined;
    try {
      const user = await requireAuthUser(req, true);
      userId = user!.id;
      authEmail = user!.email;
    } catch {
      return jsonResponse({
        ok: false,
        error: 'Войдите во вкладку «Аккаунт», чтобы оформить Premium',
        code: 'AUTH_REQUIRED',
      }, 401);
    }

    const body = (await req.json()) as CreatePaymentBody;
    const plan = body.plan;

    if (plan !== 'monthly' && plan !== 'yearly' && plan !== 'lifetime') {
      return jsonResponse({ ok: false, error: 'plan: monthly | yearly | lifetime' }, 400);
    }

    const shopId = Deno.env.get('YOOKASSA_SHOP_ID');
    const secretKey = Deno.env.get('YOOKASSA_SECRET_KEY');

    if (!shopId || !secretKey) {
      return jsonResponse({
        ok: false,
        error: 'Платежи не настроены. Задайте YOOKASSA_SHOP_ID и YOOKASSA_SECRET_KEY в Supabase.',
        code: 'PAYMENTS_NOT_CONFIGURED',
      }, 503);
    }

    const amountRub = PLAN_PRICES[plan];
    const sessionId = crypto.randomUUID();
    const returnUrl =
      body.returnUrl ??
      Deno.env.get('PAYMENT_RETURN_URL') ??
      'https://priceguard-landing.vercel.app/payment/success';

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const customerEmail = body.customerEmail?.trim() || authEmail?.trim() || undefined;

    const { error: insertError } = await supabase.from('payments').insert({
      session_id: sessionId,
      plan,
      amount_rub: amountRub,
      status: 'pending',
      customer_email: customerEmail ?? null,
      user_id: userId,
    });

    if (insertError) {
      console.error('payment insert:', insertError);
      return jsonResponse({ ok: false, error: 'Не удалось создать сессию' }, 500);
    }

    const idempotenceKey = sessionId;
    const authHeader = btoa(`${shopId}:${secretKey}`);
    const description = `PriceGuard AI Premium — ${PLAN_LABELS[plan] ?? plan}`;
    const amountValue = amountRub.toFixed(2);
    // vat_code: 1 = НДС 20%, 6 = без НДС (УСН). Задаётся секретом YOOKASSA_VAT_CODE.
    const vatCode = Number(Deno.env.get('YOOKASSA_VAT_CODE') ?? '1') || 1;

    // Чек 54-ФЗ: нужен email (или телефон) + включённая фискализация в кабинете ЮKassa
    const receipt = customerEmail
      ? {
          customer: { email: customerEmail },
          items: [
            {
              description: description.slice(0, 128),
              quantity: '1.00',
              amount: { value: amountValue, currency: 'RUB' },
              vat_code: vatCode,
              payment_mode: 'full_payment',
              payment_subject: 'service',
            },
          ],
        }
      : undefined;

    const yookassaResponse = await fetch('https://api.yookassa.ru/v3/payments', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Basic ${authHeader}`,
        'Idempotence-Key': idempotenceKey,
      },
      body: JSON.stringify({
        amount: { value: amountValue, currency: 'RUB' },
        capture: true,
        confirmation: {
          type: 'redirect',
          return_url: `${returnUrl}?session=${sessionId}`,
        },
        description,
        metadata: { session_id: sessionId, plan, user_id: userId },
        ...(receipt ? { receipt } : {}),
      }),
    });

    if (!yookassaResponse.ok) {
      const errText = await yookassaResponse.text();
      console.error('yookassa create:', errText);
      return jsonResponse({ ok: false, error: 'Ошибка создания платежа ЮKassa' }, 502);
    }

    const payment = await yookassaResponse.json();

    await supabase
      .from('payments')
      .update({ yookassa_payment_id: payment.id })
      .eq('session_id', sessionId);

    const paymentUrl = payment.confirmation?.confirmation_url;

    if (!paymentUrl) {
      return jsonResponse({ ok: false, error: 'Нет ссылки на оплату' }, 502);
    }

    return jsonResponse({
      ok: true,
      sessionId,
      paymentUrl,
      amountRub,
      plan,
    });
  } catch (error) {
    console.error('create-payment:', error);
    return jsonResponse({ ok: false, error: 'Внутренняя ошибка' }, 500);
  }
});
