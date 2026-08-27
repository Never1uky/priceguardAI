import { describe, expect, it } from 'vitest';
import {
  localTrackedProductId,
  reconstructTrackedProductUrl,
} from '@/lib/supabase/tracked-sync';

describe('tracked-sync Ali pull mapping (ALI-6)', () => {
  it('does not map Ali to yandex-/aliexpress- fallback ids or wrong hosts', () => {
    expect(localTrackedProductId('aliexpress', '1005001234567890')).toBe('ae-1005001234567890');
    expect(localTrackedProductId('yandex_market', '5001111111')).toBe('yandex-5001111111');
    expect(
      reconstructTrackedProductUrl('aliexpress', '1005001234567890', null),
    ).toBe('https://aliexpress.ru/item/1005001234567890.html');
    expect(
      reconstructTrackedProductUrl(
        'aliexpress',
        '1005001234567890',
        'https://aliexpress.ru/item/1005001234567890.html?spm=a2g2w.detail',
      ),
    ).toBe('https://aliexpress.ru/item/1005001234567890.html');
  });
});
