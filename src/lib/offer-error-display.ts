import { errorSuggestsVpnHint } from '@/lib/ozon-serp-dom';

/**
 * Map raw offer.error strings to popup copy.
 * Rate-limit wording only for real 429 / quota — never for generic 5xx or «временно недоступна».
 */
export function formatOfferErrorForDisplay(error: string): {
  text: string;
  title?: string;
  vpnHint?: boolean;
} {
  const trimmed = error.trim();

  if (/ограничивает автоматический поиск|подтвердите.*не робот|captcha|antibot/i.test(trimmed)) {
    return {
      text: /ozon/i.test(trimmed)
        ? 'Ozon временно ограничивает автоматический поиск. Укажите ссылку на карточку вручную.'
        : 'Площадка временно ограничивает автоматический поиск. Укажите ссылку вручную.',
      title: trimmed,
      vpnHint: true,
    };
  }

  if (/лимит запросов|слишком много запросов|\b429\b|rate.?limit/i.test(trimmed)) {
    const mp =
      /wildberries|wb/i.test(trimmed)
        ? 'Wildberries'
        : /ozon/i.test(trimmed)
          ? 'Ozon'
          : /яндекс|я\.?маркет|yandex/i.test(trimmed)
            ? 'Яндекс.Маркет'
            : null;
    const text = mp
      ? `${mp} временно недоступен из‑за лимита запросов. Попробуйте позже или укажите ссылку вручную.`
      : 'Площадка временно недоступна из‑за лимита запросов. Попробуйте позже или укажите ссылку вручную.';
    return { text, title: trimmed, vpnHint: true };
  }

  const queryMatch = trimmed.match(/\(запрос:\s*«([^»]+)»\)/i);
  if (queryMatch || /не найден подходящий|не найден в выдаче|в выдаче не найден/i.test(trimmed)) {
    return {
      text: 'Подходящий товар в выдаче не найден. Укажите ссылку вручную.',
      title: queryMatch ? `Запрос: ${queryMatch[1]}` : trimmed,
      vpnHint: errorSuggestsVpnHint(trimmed),
    };
  }

  return { text: trimmed, vpnHint: errorSuggestsVpnHint(trimmed) };
}
