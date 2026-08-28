import { describe, expect, it } from 'vitest';
import {
  localTrackedProductId,
  reconstructTrackedProductUrl,
} from '@/lib/supabase/tracked-sync';

describe('tracked-sync M.Video pull mapping (MVIDEO-6)', () => {
  it('does not map mvideo to yandex-/mvideo- fallback ids or wrong hosts', () => {
    expect(localTrackedProductId('mvideo', '30066712')).toBe('mv-30066712');
    expect(localTrackedProductId('yandex_market', '5001111111')).toBe('yandex-5001111111');
    expect(reconstructTrackedProductUrl('mvideo', '30066712', null)).toBe(
      'https://www.mvideo.ru/products/30066712',
    );
    expect(
      reconstructTrackedProductUrl(
        'mvideo',
        '30066712',
        'https://www.mvideo.ru/products/smartfon-30066712?utm=1',
      ),
    ).toBe('https://www.mvideo.ru/products/smartfon-30066712');
    expect(
      reconstructTrackedProductUrl(
        'mvideo',
        '12345678',
        'https://www.eldorado.ru/cat/detail/phone-12345678/?x=1',
      ),
    ).toBe('https://www.eldorado.ru/cat/detail/phone-12345678');
  });
});
