import { describe, expect, it } from 'vitest';
import {
  localTrackedProductId,
  reconstructTrackedProductUrl,
} from '@/lib/supabase/tracked-sync';

describe('tracked-sync Mega pull mapping (MEGA-6)', () => {
  it('does not map Mega to yandex- ids or YM URLs', () => {
    expect(localTrackedProductId('megamarket', '100067205836')).toBe('mm-100067205836');
    expect(localTrackedProductId('yandex_market', '5001111111')).toBe('yandex-5001111111');
    expect(
      reconstructTrackedProductUrl('megamarket', '100067205836', null),
    ).toBe('https://megamarket.ru/catalog/details/100067205836');
    expect(
      reconstructTrackedProductUrl(
        'megamarket',
        '100067205836',
        'https://www.sbermegamarket.ru/catalog/details/item-100067205836/?x=1',
      ),
    ).toBe('https://megamarket.ru/catalog/details/item-100067205836');
  });
});
