import { describe, expect, it } from 'vitest';
import {
  mergeAlertSettingsFromCloud,
  shouldPreserveCloudTelegram,
  type CloudAlertSettings,
} from '@/lib/supabase/alert-settings-merge';
import type { PriceAlertSettings } from '@/lib/compare-price-alerts';

const localEmpty: PriceAlertSettings = {
  notificationsEnabled: true,
  minDropRub: 100,
  minDropPercent: 1,
  compareAlerts: true,
  telegramEnabled: false,
  telegramChatId: '',
};

const cloudBound: CloudAlertSettings = {
  telegramChatId: '999888777',
  telegramEnabled: true,
  notificationsEnabled: true,
  minDropRub: 50,
  minDropPercent: 2,
  serverMonitoring: true,
};

describe('mergeAlertSettingsFromCloud', () => {
  it('restores cloud chat into empty local', () => {
    const merged = mergeAlertSettingsFromCloud(localEmpty, cloudBound);
    expect(merged).toEqual({
      ...localEmpty,
      telegramChatId: '999888777',
      telegramEnabled: true,
      notificationsEnabled: true,
      minDropRub: 50,
      minDropPercent: 2,
    });
  });

  it('does not overwrite local chat', () => {
    const local = { ...localEmpty, telegramChatId: '111', telegramEnabled: true };
    expect(mergeAlertSettingsFromCloud(local, cloudBound)).toBeNull();
  });

  it('returns null when cloud empty', () => {
    expect(
      mergeAlertSettingsFromCloud(localEmpty, {
        ...cloudBound,
        telegramChatId: '',
      }),
    ).toBeNull();
  });
});

describe('shouldPreserveCloudTelegram', () => {
  it('preserves when push empty without clear', () => {
    expect(
      shouldPreserveCloudTelegram({
        incomingChatId: '',
        clearTelegram: false,
        existingChatId: '999888777',
      }),
    ).toBe(true);
  });

  it('does not preserve when clearTelegram', () => {
    expect(
      shouldPreserveCloudTelegram({
        incomingChatId: '',
        clearTelegram: true,
        existingChatId: '999888777',
      }),
    ).toBe(false);
  });

  it('does not preserve when incoming has chat', () => {
    expect(
      shouldPreserveCloudTelegram({
        incomingChatId: '123',
        clearTelegram: false,
        existingChatId: '999888777',
      }),
    ).toBe(false);
  });
});
