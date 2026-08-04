/**
 * Verify a YooKassa payment by fetching it from the API (webhook bodies are not trusted).
 */

export interface YookassaPaymentVerified {
  id: string;
  status: string;
  amountValue: number;
  currency: string;
  sessionId: string | null;
  metadata: Record<string, unknown>;
}

export async function fetchYookassaPayment(
  paymentId: string,
): Promise<YookassaPaymentVerified | null> {
  const shopId = Deno.env.get('YOOKASSA_SHOP_ID')?.trim();
  const secretKey = Deno.env.get('YOOKASSA_SECRET_KEY')?.trim();
  if (!shopId || !secretKey || !paymentId) return null;

  const authHeader = btoa(`${shopId}:${secretKey}`);
  const res = await fetch(`https://api.yookassa.ru/v3/payments/${encodeURIComponent(paymentId)}`, {
    method: 'GET',
    headers: {
      Authorization: `Basic ${authHeader}`,
    },
  });

  if (!res.ok) {
    console.error('[yookassa] GET payment failed:', res.status);
    return null;
  }

  const payment = await res.json();
  const amountRaw = payment?.amount?.value;
  const amountValue = typeof amountRaw === 'string' ? Number(amountRaw) : Number(amountRaw);
  const metadata = (payment?.metadata ?? {}) as Record<string, unknown>;
  const sessionId =
    typeof metadata.session_id === 'string' ? metadata.session_id : null;

  return {
    id: String(payment.id ?? paymentId),
    status: String(payment.status ?? ''),
    amountValue: Number.isFinite(amountValue) ? amountValue : NaN,
    currency: String(payment?.amount?.currency ?? ''),
    sessionId,
    metadata,
  };
}
