import { describe, expect, it } from 'vitest';
import {
  STORE_CONFIG,
  detectStoreChannelFromUa,
  getPrimaryInstallUrl,
  getPrimaryReviewUrl,
  listKnownExtensionIds,
  resolveInstallUrlForUa,
  resolveReviewUrlForUa,
} from './store-config';

describe('store-config', () => {
  it('chrome listing is fully set (CWS production)', () => {
    expect(STORE_CONFIG.chrome.extensionId).toBe('ipaichogganccpnapdgkjldplllnjlpf');
    expect(STORE_CONFIG.chrome.storeUrl).toContain('chromewebstore.google.com');
    expect(STORE_CONFIG.chrome.reviewUrl).toContain('/reviews');
  });

  it('edge and yandex stay null until real IDs exist', () => {
    expect(STORE_CONFIG.edge.extensionId).toBeNull();
    expect(STORE_CONFIG.edge.storeUrl).toBeNull();
    expect(STORE_CONFIG.yandex.extensionId).toBeNull();
    expect(STORE_CONFIG.yandex.storeUrl).toBeNull();
  });

  it('primary helpers never return null (CWS fallback)', () => {
    expect(getPrimaryInstallUrl()).toBe(STORE_CONFIG.chrome.storeUrl);
    expect(getPrimaryReviewUrl()).toBe(STORE_CONFIG.chrome.reviewUrl);
  });

  it('listKnownExtensionIds excludes null placeholders', () => {
    expect(listKnownExtensionIds()).toEqual(['ipaichogganccpnapdgkjldplllnjlpf']);
  });

  it('detectStoreChannelFromUa: Edge before Chrome, YaBrowser → yandex', () => {
    expect(
      detectStoreChannelFromUa(
        'Mozilla/5.0 Chrome/120.0.0.0 Edg/120.0.0.0',
      ),
    ).toBe('edge');
    expect(detectStoreChannelFromUa('Mozilla/5.0 Chrome/120.0.0.0 YaBrowser/24.0')).toBe(
      'yandex',
    );
    expect(detectStoreChannelFromUa('Mozilla/5.0 Chrome/120.0.0.0 Safari/537.36')).toBe(
      'chrome',
    );
  });

  it('resolve* falls back to CWS while edge/yandex URLs are null', () => {
    const edgeUa = 'Mozilla/5.0 Chrome/120.0.0.0 Edg/120.0.0.0';
    expect(resolveInstallUrlForUa(edgeUa)).toBe(STORE_CONFIG.chrome.storeUrl);
    expect(resolveReviewUrlForUa(edgeUa)).toBe(STORE_CONFIG.chrome.reviewUrl);
  });
});
