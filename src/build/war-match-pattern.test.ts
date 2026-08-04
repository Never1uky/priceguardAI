import { describe, expect, it } from 'vitest';
import {
  contentMatchesToWarOrigins,
  toWarOriginMatch,
} from './war-match-pattern';

describe('toWarOriginMatch', () => {
  it('strips path to /*', () => {
    expect(toWarOriginMatch('https://www.wildberries.ru/catalog/*')).toBe(
      'https://www.wildberries.ru/*',
    );
    expect(toWarOriginMatch('https://www.ozon.ru/search*')).toBe('https://www.ozon.ru/*');
    expect(toWarOriginMatch('https://market.yandex.ru/product*')).toBe(
      'https://market.yandex.ru/*',
    );
    expect(toWarOriginMatch('https://market.yandex.ru/cc/*')).toBe(
      'https://market.yandex.ru/*',
    );
  });

  it('keeps already-origin patterns', () => {
    expect(toWarOriginMatch('https://ozon.ru/*')).toBe('https://ozon.ru/*');
  });

  it('preserves <all_urls>', () => {
    expect(toWarOriginMatch('<all_urls>')).toBe('<all_urls>');
  });
});

describe('contentMatchesToWarOrigins', () => {
  it('dedupes multiple paths on the same host', () => {
    expect(
      contentMatchesToWarOrigins([
        'https://www.ozon.ru/product/*',
        'https://www.ozon.ru/search*',
        'https://ozon.ru/product/*',
        'https://market.yandex.ru/search*',
        'https://market.yandex.ru/card*',
      ]),
    ).toEqual([
      'https://www.ozon.ru/*',
      'https://ozon.ru/*',
      'https://market.yandex.ru/*',
    ]);
  });
});
