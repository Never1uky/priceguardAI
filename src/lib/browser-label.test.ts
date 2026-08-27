import { describe, expect, it } from 'vitest';
import { detectBrowserLabelFromUa } from './browser-label';

describe('detectBrowserLabelFromUa', () => {
  it('detects Edge before Chrome token', () => {
    expect(
      detectBrowserLabelFromUa(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0',
      ),
    ).toBe('edge');
  });

  it('detects Yandex via YaBrowser (would look like Chrome otherwise)', () => {
    const yandex =
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 YaBrowser/26.6.0.1845 Yowser/2.5 Safari/537.36';
    expect(detectBrowserLabelFromUa(yandex)).toBe('yandex');
  });

  it('detects plain Chrome', () => {
    expect(
      detectBrowserLabelFromUa(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      ),
    ).toBe('chrome');
  });

  it('returns unknown for empty / non-chromium', () => {
    expect(detectBrowserLabelFromUa('')).toBe('unknown');
    expect(
      detectBrowserLabelFromUa(
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:120.0) Gecko/20100101 Firefox/120.0',
      ),
    ).toBe('unknown');
  });
});
