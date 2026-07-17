import { functionsUrl, getSupabaseConfig } from '@/lib/supabase/config';
import type { AuthenticityStatus } from '@/types/authenticity';
import type { Marketplace } from '@/types/product';

/** Анонимная статистика проверок (только если Supabase настроен). */
export async function logAuthenticityCheck(payload: {
  marketplace: Marketplace;
  article?: string;
  status: AuthenticityStatus;
  source: 'track' | 'compare' | 'scrape';
}): Promise<void> {
  const { configured, anonKey } = getSupabaseConfig();
  if (!configured) return;

  try {
    await fetch(functionsUrl('log-authenticity'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${anonKey}`,
        apikey: anonKey,
      },
      body: JSON.stringify({
        ...payload,
        extensionVersion: chrome.runtime.getManifest().version,
      }),
    });
  } catch {
    // не мешаем основному сценарию
  }
}
