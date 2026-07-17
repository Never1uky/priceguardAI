export type UiTheme = 'light' | 'dark';

const THEME_KEY = 'priceguard_ui_theme';

export async function loadUiTheme(): Promise<UiTheme> {
  const stored = await chrome.storage.local.get(THEME_KEY);
  return stored[THEME_KEY] === 'dark' ? 'dark' : 'light';
}

export async function saveUiTheme(theme: UiTheme): Promise<void> {
  await chrome.storage.local.set({ [THEME_KEY]: theme });
}
