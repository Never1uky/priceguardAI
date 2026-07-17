(function () {
  "use strict";

  if (window.__fixitLayerLoaded) return;
  window.__fixitLayerLoaded = true;

  const HIDDEN_CLASS = "fixit-hidden";
  const MAIN_CLASS = "fixit-main-content";

  const AD_SELECTORS = [
    '[class*="ad-"]', '[class*="ads-"]', '[class*="advert"]',
    '[id*="ad-"]', '[id*="ads-"]', '[id*="advert"]',
    '[data-ad]', '[data-ad-slot]', '[data-adunit]',
    ".adsbygoogle", "#google_ads", ".ad-container", ".ad-wrapper",
    ".sponsored", '[class*="sponsor"]',
    'iframe[src*="doubleclick"]', 'iframe[src*="googlesyndication"]',
    'iframe[src*="adnxs"]', 'iframe[src*="taboola"]',
    'iframe[src*="outbrain"]', '[aria-label*="advertisement" i]'
  ];

  const COOKIE_SELECTORS = [
    '[class*="cookie"]', '[id*="cookie"]',
    '[class*="consent"]', '[id*="consent"]',
    '[class*="gdpr"]', '[id*="gdpr"]',
    "#onetrust-banner-sdk", ".cc-banner", ".cc-window",
    '[class*="privacy-banner"]', '[class*="cookie-notice"]',
    '[aria-label*="cookie" i]', '[aria-label*="consent" i]'
  ];

  const POPUP_SELECTORS = [
    '[role="dialog"]', '[aria-modal="true"]',
    ".modal", ".popup", ".overlay",
    '[class*="newsletter"]', '[class*="subscribe-popup"]',
    '[class*="lightbox"]', '[class*="interstitial"]',
    ".fancybox-overlay", ".mfp-wrap"
  ];

  const SIDEBAR_SELECTORS = [
    "aside", '[role="complementary"]',
    '[class*="sidebar"]', '[id*="sidebar"]',
    '[class*="side-bar"]', "nav.widget-area"
  ];

  const state = {
    fixed: false,
    cleanMode: false,
    focusMode: false,
    darkMode: false,
    mainContent: null,
    hiddenElements: new WeakSet(),
    uiBuilt: false
  };

  // ── Content detection ──

  function scoreElement(el) {
    if (!el || el === document.body || el === document.documentElement) return 0;
    const rect = el.getBoundingClientRect();
    if (rect.width < 200 || rect.height < 100) return 0;

    const text = (el.innerText || "").trim();
    const textLen = text.length;
    const pCount = el.querySelectorAll(":scope > p, :scope p").length;
    const tag = el.tagName.toLowerCase();

    let score = textLen;
    if (tag === "article") score *= 3;
    if (tag === "main") score *= 2.5;
    if (pCount >= 3) score += pCount * 200;

    return score;
  }

  function detectMainContent() {
    const candidates = [];

    document.querySelectorAll("article").forEach((el) => candidates.push(el));
    document.querySelectorAll("main").forEach((el) => candidates.push(el));

    const divs = document.querySelectorAll("div, section");
    let bestP = null;
    let maxP = 0;
    divs.forEach((div) => {
      const directP = div.querySelectorAll(":scope > p").length;
      const totalP = div.querySelectorAll("p").length;
      const pScore = directP * 2 + totalP;
      if (pScore > maxP) {
        maxP = pScore;
        bestP = div;
      }
    });
    if (bestP && maxP >= 2) candidates.push(bestP);

    let best = null;
    let bestScore = 0;
    candidates.forEach((el) => {
      const s = scoreElement(el);
      if (s > bestScore) {
        bestScore = s;
        best = el;
      }
    });

    if (!best) {
      let largest = null;
      let largestArea = 0;
      document.querySelectorAll("div, section, article, main").forEach((el) => {
        const rect = el.getBoundingClientRect();
        const area = rect.width * rect.height;
        const textLen = (el.innerText || "").length;
        if (area > largestArea && textLen > 200) {
          largestArea = area;
          largest = el;
        }
      });
      best = largest;
    }

    return best;
  }

  function ensureMainContent() {
    if (state.mainContent && document.contains(state.mainContent)) {
      return state.mainContent;
    }
    state.mainContent = detectMainContent();
    if (state.mainContent) {
      state.mainContent.classList.add(MAIN_CLASS);
    }
    return state.mainContent;
  }

  // ── Hide elements (reversible) ──

  function hideElement(el) {
    if (!el || state.hiddenElements.has(el)) return;
    if (el.id === "fixit-root" || el.closest("#fixit-root")) return;
    if (state.mainContent && (el === state.mainContent || state.mainContent.contains(el))) return;

    el.classList.add(HIDDEN_CLASS);
    state.hiddenElements.add(el);
  }

  function hideBySelectors(selectors) {
    selectors.forEach((selector) => {
      try {
        document.querySelectorAll(selector).forEach(hideElement);
      } catch (_) {
        /* invalid selector */
      }
    });
  }

  function hideSidebars() {
    const main = ensureMainContent();
    SIDEBAR_SELECTORS.forEach((selector) => {
      try {
        document.querySelectorAll(selector).forEach((el) => {
          if (main && (el === main || main.contains(el) || el.contains(main))) return;
          hideElement(el);
        });
      } catch (_) {
        /* invalid selector */
      }
    });
  }

  // ── Actions ──

  function fixPage() {
    ensureMainContent();
    hideBySelectors(AD_SELECTORS);
    hideBySelectors(COOKIE_SELECTORS);
    hideBySelectors(POPUP_SELECTORS);
    hideSidebars();
    state.fixed = true;
    syncState();
    updateMenuUI();
  }

  function toggleCleanMode() {
    state.cleanMode = !state.cleanMode;
    const main = ensureMainContent();
    document.body.classList.toggle("fixit-clean-active", state.cleanMode);
    if (main) main.classList.toggle("fixit-clean", state.cleanMode);
    if (state.cleanMode) {
      document.body.classList.toggle("fixit-dark", state.darkMode);
    }
    syncState();
    updateMenuUI();
  }

  function toggleFocusMode() {
    state.focusMode = !state.focusMode;
    const main = ensureMainContent();
    document.body.classList.toggle("fixit-focus-active", state.focusMode);
    if (main) main.classList.toggle("fixit-focused", state.focusMode);
    syncState();
    updateMenuUI();
  }

  function toggleDarkMode() {
    state.darkMode = !state.darkMode;
    document.body.classList.toggle("fixit-dark", state.darkMode);
    chrome.storage.local.set({ fixitPreferences: { darkMode: state.darkMode } });
    syncState();
    updateMenuUI();
  }

  function resetPage() {
    document.querySelectorAll(`.${HIDDEN_CLASS}`).forEach((el) => {
      el.classList.remove(HIDDEN_CLASS);
    });

    document.body.classList.remove(
      "fixit-clean-active", "fixit-focus-active", "fixit-dark"
    );

    document.querySelectorAll(`.${MAIN_CLASS}`).forEach((el) => {
      el.classList.remove(MAIN_CLASS, "fixit-clean", "fixit-focused");
    });

    state.fixed = false;
    state.cleanMode = false;
    state.focusMode = false;
    state.mainContent = null;
    state.hiddenElements = new WeakSet();

    syncState();
    updateMenuUI();
  }

  function syncState() {
    try {
      chrome.runtime.sendMessage({
        type: "SET_TAB_STATE",
        state: {
          fixed: state.fixed,
          cleanMode: state.cleanMode,
          focusMode: state.focusMode,
          darkMode: state.darkMode
        }
      });
    } catch (_) {
      /* extension context invalidated */
    }
  }

  // ── Floating UI ──

  function buildUI() {
    if (state.uiBuilt) return;
    state.uiBuilt = true;

    const root = document.createElement("div");
    root.id = "fixit-root";

    root.innerHTML = `
      <div id="fixit-menu" role="menu">
        <button class="fixit-menu-item" data-action="fix" role="menuitem">
          <svg viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 14H9V8h2v8zm4 0h-2V8h2v8z"/></svg>
          Fix this page
        </button>
        <button class="fixit-menu-item" data-action="clean" role="menuitem">
          <svg viewBox="0 0 24 24"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>
          Clean mode
        </button>
        <button class="fixit-menu-item" data-action="focus" role="menuitem">
          <svg viewBox="0 0 24 24"><path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/></svg>
          Focus mode
        </button>
        <button class="fixit-menu-item" data-action="dark" role="menuitem">
          <svg viewBox="0 0 24 24"><path d="M12 3a9 9 0 1 0 9 9c0-.46-.04-.92-.1-1.36a5.389 5.389 0 0 1-4.4 2.26 5.403 5.403 0 0 1-3.14-9.8c-.44-.06-.9-.1-1.36-.1z"/></svg>
          Dark background
        </button>
        <button class="fixit-menu-item fixit-reset" data-action="reset" role="menuitem">
          <svg viewBox="0 0 24 24"><path d="M12 5V1L7 6l5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6H4c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z"/></svg>
          Reset page
        </button>
      </div>
      <button id="fixit-toggle" aria-label="FixIt Layer" aria-haspopup="true">
        <svg viewBox="0 0 24 24"><path d="M19.14 12.94c.04-.31.06-.63.06-.94 0-.31-.02-.63-.06-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.49.49 0 0 0-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.484.484 0 0 0-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.04.31-.06.63-.06.94s.02.63.06.94l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z"/></svg>
        Fix this page
      </button>
    `;

    document.body.appendChild(root);

    const toggle = root.querySelector("#fixit-toggle");
    const menu = root.querySelector("#fixit-menu");

    toggle.addEventListener("click", (e) => {
      e.stopPropagation();
      menu.classList.toggle("fixit-menu-open");
    });

    menu.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-action]");
      if (!btn) return;
      e.stopPropagation();
      runAction(btn.dataset.action);
      if (btn.dataset.action !== "reset") {
        menu.classList.remove("fixit-menu-open");
      }
    });

    document.addEventListener("click", () => {
      menu.classList.remove("fixit-menu-open");
    });
  }

  function updateMenuUI() {
    const menu = document.getElementById("fixit-menu");
    if (!menu) return;
    menu.querySelector('[data-action="fix"]')?.classList.toggle("fixit-active", state.fixed);
    menu.querySelector('[data-action="clean"]')?.classList.toggle("fixit-active", state.cleanMode);
    menu.querySelector('[data-action="focus"]')?.classList.toggle("fixit-active", state.focusMode);
    menu.querySelector('[data-action="dark"]')?.classList.toggle("fixit-active", state.darkMode);
  }

  function runAction(action) {
    switch (action) {
      case "fix": fixPage(); break;
      case "clean": toggleCleanMode(); break;
      case "focus": toggleFocusMode(); break;
      case "dark": toggleDarkMode(); break;
      case "reset": resetPage(); break;
    }
  }

  // ── Messages from popup / background ──

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type === "ACTION") {
      runAction(message.action);
      sendResponse({ ok: true });
      return true;
    }
    if (message.type === "GET_STATE") {
      sendResponse({
        fixed: state.fixed,
        cleanMode: state.cleanMode,
        focusMode: state.focusMode,
        darkMode: state.darkMode
      });
      return true;
    }
  });

  // ── Init ──

  function init() {
    buildUI();
    chrome.storage.local.get("fixitPreferences", (result) => {
      if (result.fixitPreferences?.darkMode) {
        state.darkMode = true;
      }
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
