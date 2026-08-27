import { describe, expect, it } from 'vitest';
import {
  isPromoSerpTitle,
  pickSerpTitleFromTile,
  resolveCandidateDisplayTitle,
  sanitizeSerpTitle,
  titleFromProductUrl,
} from '@/lib/serp-title';

describe('serp-title', () => {
  it('flags promo badge titles', () => {
    expect(isPromoSerpTitle('250 баллов')).toBe(true);
    expect(isPromoSerpTitle('250 балло…')).toBe(true);
    expect(isPromoSerpTitle('Фотоаппарат Canon 650D EF-S 18-55mm')).toBe(false);
  });

  it('pickSerpTitleFromTile prefers product headline over promo link text', () => {
    const title = pickSerpTitleFromTile({
      headline: 'Фотоаппарат Canon EOS 650D Kit EF-S 18-55mm',
      linkText: '250 баллов',
      fallback: 'query',
    });
    expect(title).toMatch(/Canon/i);
    expect(title).not.toMatch(/балл/i);
  });

  it('sanitizeSerpTitle falls back to container lines', () => {
    const title = sanitizeSerpTitle(
      '250 баллов',
      '250 баллов\nФотоаппарат Canon 650D\n54 273 ₽',
    );
    expect(title).toMatch(/Canon 650D/i);
  });

  it('flags Ozon promo badge titles', () => {
    expect(isPromoSerpTitle('Распрод')).toBe(true);
    expect(isPromoSerpTitle('Распродажа')).toBe(true);
    expect(isPromoSerpTitle('Осталось 4 шт')).toBe(true);
    expect(isPromoSerpTitle('Рекомендуем')).toBe(true);
    expect(isPromoSerpTitle('Кроссовки TRACE LOW M')).toBe(false);
  });

  it('pickSerpTitleFromTile skips Ozon badges for real product name', () => {
    const title = pickSerpTitleFromTile({
      linkText: 'Распрод',
      headline: 'Кроссовки TRACE LOW M',
      containerText: 'Распрод\nОсталось 4 шт\nКроссовки TRACE LOW M\n4 990 ₽',
      fallback: 'кроссовки',
    });
    expect(title).toMatch(/TRACE LOW M/i);
    expect(title).not.toMatch(/распрод/i);
  });

  it('sanitizeSerpTitle uses product URL slug when title is promo-only', () => {
    const title = sanitizeSerpTitle(
      '250 баллов',
      undefined,
      'https://www.ozon.ru/product/apple-smartfon-iphone-17-pro-sim-esim-123456789/',
    );
    expect(title).toMatch(/Apple Smartfon Iphone 17 Pro/i);
    expect(title).not.toMatch(/балл/i);
  });

  it('resolveCandidateDisplayTitle prefers card title over promo SERP', () => {
    const title = resolveCandidateDisplayTitle({
      serpTitle: '250 баллов',
      cardTitle: 'Apple Смартфон iPhone 17 Pro Sim+eSim 12/256Gb',
      url: 'https://www.ozon.ru/product/apple-iphone-17-pro-123/',
    });
    expect(title).toMatch(/iPhone 17 Pro/i);
    expect(title).not.toMatch(/балл/i);
  });

  it('titleFromProductUrl decodes Ozon slug', () => {
    expect(
      titleFromProductUrl('https://www.ozon.ru/product/krossovki-trace-low-m-99887766/'),
    ).toMatch(/Trace Low M/i);
  });

  it('titleFromProductUrl decodes Yandex Market /card/ slug', () => {
    expect(
      titleFromProductUrl(
        'https://market.yandex.ru/card/shampun-protiv-perkhoti-head--shoulders-old-spice/4624539067',
      ),
    ).toMatch(/Head Shoulders Old Spice/i);
  });

  it('titleFromProductUrl decodes Megamarket /catalog/details/ slug', () => {
    expect(
      titleFromProductUrl(
        'https://megamarket.ru/catalog/details/smartfon-google-pixel-10-1002003004/',
      ),
    ).toMatch(/Google Pixel/i);
  });
});
