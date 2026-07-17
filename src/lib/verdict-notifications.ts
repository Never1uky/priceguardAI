import { VERDICT_LABELS } from '@/types/review-analysis';
import type { PurchaseVerdict } from '@/types/review-analysis';

const NOTIFICATION_ICON = 'public/icons/icon128.png';

export async function showVerdictChangeNotification(
  productTitle: string,
  productUrl: string,
  previousVerdict: PurchaseVerdict,
  newVerdict: PurchaseVerdict,
): Promise<void> {
  const title = 'Изменился вердикт AI';
  const message = `«${productTitle.slice(0, 50)}…»: ${VERDICT_LABELS[previousVerdict]} → ${VERDICT_LABELS[newVerdict]}`;

  await chrome.storage.local.set({ priceguard_last_notification_url: productUrl });

  await chrome.notifications.create(`verdict-change-${Date.now()}`, {
    type: 'basic',
    iconUrl: chrome.runtime.getURL(NOTIFICATION_ICON),
    title,
    message,
    priority: 2,
    requireInteraction: true,
  });
}
