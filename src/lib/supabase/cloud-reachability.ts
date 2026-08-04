/**
 * Флаг «облако недоступно» (DNS/VPN/Zapret) для Settings UI.
 * Не путать с VPN-hint для поиска маркетплейсов.
 */

const STORAGE_KEY = 'priceguard_cloud_network_warn';

export const CLOUD_NETWORK_WARN_MESSAGE =
  'Не удаётся связаться с сервером (DNS/сеть). Если включён VPN или Zapret — отключите или выберите сервер, где открывается supabase.co / Telegram. Локальный список товаров сохраняется.';

let lastWarnAt = 0;
const WARN_LOG_COOLDOWN_MS = 15_000;

export function isCloudNetworkError(error: unknown): boolean {
  if (
    error &&
    typeof error === 'object' &&
    'failureKind' in error &&
    ((error as { failureKind?: string }).failureKind === 'offline' ||
      (error as { failureKind?: string }).failureKind === 'network')
  ) {
    return true;
  }
  if (
    error &&
    typeof error === 'object' &&
    'kind' in error &&
    ((error as { kind?: string }).kind === 'offline' ||
      (error as { kind?: string }).kind === 'network')
  ) {
    return true;
  }
  const msg = (error instanceof Error ? error.message : String(error ?? '')).toLowerCase();
  return (
    msg.includes('failed to fetch') ||
    msg.includes('networkerror') ||
    msg.includes('network request failed') ||
    msg.includes('err_name_not_resolved') ||
    msg.includes('name_not_resolved') ||
    msg.includes('net::') ||
    msg.includes('dns') ||
    msg.includes('load failed') ||
    msg.includes('не удалось связаться') ||
    msg.includes('нет сети')
  );
}

export async function setCloudNetworkWarning(active: boolean): Promise<void> {
  if (typeof chrome === 'undefined' || !chrome.storage?.local) return;
  try {
    if (active) {
      await chrome.storage.local.set({
        [STORAGE_KEY]: { active: true, at: Date.now() },
      });
    } else {
      await chrome.storage.local.remove(STORAGE_KEY);
    }
  } catch {
    // ignore
  }
}

export async function getCloudNetworkWarning(): Promise<boolean> {
  if (typeof chrome === 'undefined' || !chrome.storage?.local) return false;
  try {
    const stored = await chrome.storage.local.get(STORAGE_KEY);
    const v = stored[STORAGE_KEY] as { active?: boolean } | undefined;
    return Boolean(v?.active);
  } catch {
    return false;
  }
}

/** Один warn в консоль + флаг UI (не спамить Failed to fetch). */
export function noteCloudNetworkFailure(source: string, error?: unknown): void {
  const now = Date.now();
  if (now - lastWarnAt >= WARN_LOG_COOLDOWN_MS) {
    lastWarnAt = now;
    const detail =
      error instanceof Error ? error.message : error != null ? String(error) : '';
    console.warn(
      `[PriceGuard] Cloud unreachable (${source})${detail ? `: ${detail}` : ''}. Check VPN/Zapret/DNS.`,
    );
  }
  void setCloudNetworkWarning(true);
}

export function clearCloudNetworkWarning(): void {
  void setCloudNetworkWarning(false);
}

export const CLOUD_NETWORK_WARN_STORAGE_KEY = STORAGE_KEY;
