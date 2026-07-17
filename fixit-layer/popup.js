const buttons = document.querySelectorAll(".btn[data-action]");

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function sendAction(action) {
  const tab = await getActiveTab();
  if (!tab?.id) return;

  try {
    await chrome.tabs.sendMessage(tab.id, { type: "ACTION", action });
    await refreshUI();
  } catch (_) {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["content.js"]
    });
    await chrome.tabs.sendMessage(tab.id, { type: "ACTION", action });
    await refreshUI();
  }
}

async function refreshUI() {
  const tab = await getActiveTab();
  if (!tab?.id) return;

  let pageState = null;
  try {
    pageState = await chrome.tabs.sendMessage(tab.id, { type: "GET_STATE" });
  } catch (_) {
    return;
  }

  if (!pageState) return;

  buttons.forEach((btn) => {
    const action = btn.dataset.action;
    const activeMap = {
      fix: pageState.fixed,
      clean: pageState.cleanMode,
      focus: pageState.focusMode,
      dark: pageState.darkMode
    };
    btn.classList.toggle("active", !!activeMap[action]);
  });
}

buttons.forEach((btn) => {
  btn.addEventListener("click", () => sendAction(btn.dataset.action));
});

refreshUI();
