import WebSocket from 'ws';

const list = await fetch('http://127.0.0.1:9222/json/list').then((r) => r.json());
const page = list.find((t) => t.url.startsWith('chrome://extensions'));
if (!page) {
  console.error('no extensions page', list.map((t) => t.url));
  process.exit(1);
}

const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => {
  ws.on('open', res);
  ws.on('error', rej);
});

let id = 0;
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const mid = ++id;
    const onMsg = (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.id === mid) {
        ws.off('message', onMsg);
        if (msg.error) reject(new Error(JSON.stringify(msg.error)));
        else resolve(msg.result);
      }
    };
    ws.on('message', onMsg);
    ws.send(JSON.stringify({ id: mid, method, params }));
  });

await send('Runtime.enable');
const expr = `(() => {
  const items = [];
  for (const c of document.querySelectorAll('extensions-manager')) {
    const root = c.shadowRoot;
    if (!root) continue;
    const itemList = root.querySelector('extensions-item-list');
    const il = itemList && itemList.shadowRoot;
    if (!il) continue;
    for (const item of il.querySelectorAll('extensions-item')) {
      const sr = item.shadowRoot;
      if (!sr) continue;
      const errorsBtn = sr.querySelector('#errors-button, .errors-button, #errors');
      const enable = sr.querySelector('#enableToggle');
      items.push({
        id: item.getAttribute('id') || item.id,
        name: (sr.querySelector('#name') && sr.querySelector('#name').textContent || '').trim(),
        version: (sr.querySelector('#version') && sr.querySelector('#version').textContent || '').trim(),
        enabled: enable ? !!enable.checked : null,
        hasErrorsControl: !!errorsBtn,
        errorText: (errorsBtn && errorsBtn.textContent || '').trim().slice(0, 200),
      });
    }
  }
  return { title: document.title, count: items.length, items };
})()`;

const r = await send('Runtime.evaluate', {
  expression: expr,
  returnByValue: true,
  awaitPromise: false,
});
console.log(JSON.stringify(r.result?.value ?? r, null, 2));

// Also list extension service workers / backgrounds from target list
const all = await fetch('http://127.0.0.1:9222/json/list').then((x) => x.json());
const extTargets = all.filter(
  (t) =>
    (t.url || '').startsWith('chrome-extension://') ||
    (t.type || '').includes('service') ||
    (t.title || '').toLowerCase().includes('priceguard'),
);
console.log('extTargets', JSON.stringify(extTargets.map((t) => ({ type: t.type, title: t.title, url: t.url })), null, 2));
ws.close();
