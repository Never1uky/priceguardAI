/** Конфигурация Supabase (из .env при сборке) */

import { agentLog } from '@/lib/debug-log';

export interface SupabaseConfig {
  url: string;
  anonKey: string;
  configured: boolean;
}

export function getSupabaseConfig(): SupabaseConfig {
  const url = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim() ?? '';
  const anonKey =
    (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)?.trim() ||
    (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined)?.trim() ||
    '';
  const configured = Boolean(url && anonKey && url.startsWith('https://'));
  if (typeof globalThis !== 'undefined') {
    const g = globalThis as { __pgSupabaseLogged?: boolean };
    if (!g.__pgSupabaseLogged) {
      g.__pgSupabaseLogged = true;
      void agentLog('supabase/config.ts:getSupabaseConfig', 'supabase config read', {
        configured,
        hasUrl: !!url,
        hasAnonKey: !!anonKey,
      }, 'D');
    }
  }

  return {
    url,
    anonKey,
    configured,
  };
}

export function functionsUrl(functionName: string): string {
  const { url } = getSupabaseConfig();
  return `${url}/functions/v1/${functionName}`;
}
