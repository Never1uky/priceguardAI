const DEFAULT_STATE = {
  fixed: false,
  cleanMode: false,
  focusMode: false,
  darkMode: false
};

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.set({ fixitPreferences: { darkMode: false } });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "GET_TAB_STATE") {
    const tabId = message.tabId ?? sender.tab?.id;
    if (!tabId) {
      sendResponse({ ...DEFAULT_STATE });
      return;
    }
    chrome.storage.session.get(`tab_${tabId}`, (result) => {
      sendResponse(result[`tab_${tabId}`] ?? { ...DEFAULT_STATE });
    });
    return true;
  }

  if (message.type === "SET_TAB_STATE") {
    const tabId = message.tabId ?? sender.tab?.id;
    if (!tabId) return;
    chrome.storage.session.set({ [`tab_${tabId}`]: message.state });
    return;
  }

  if (message.type === "EXECUTE_ACTION") {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs[0];
      if (!tab?.id) return;
      chrome.tabs.sendMessage(tab.id, {
        type: "ACTION",
        action: message.action
      });
    });
    return;
  }
});
