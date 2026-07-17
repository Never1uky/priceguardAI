const DEVICE_ID_KEY = 'priceguard_device_id';

/** Стабильный ID устройства для привязки лицензии */
export async function getDeviceId(): Promise<string> {
  const stored = await chrome.storage.local.get(DEVICE_ID_KEY);
  const existing = stored[DEVICE_ID_KEY] as string | undefined;
  if (existing) return existing;

  const id = crypto.randomUUID();
  await chrome.storage.local.set({ [DEVICE_ID_KEY]: id });
  return id;
}
