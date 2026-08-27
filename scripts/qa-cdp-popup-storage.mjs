import WebSocket from 'ws';

const PORT = process.env.CDP_PORT || '9223';
const EXT_ID = process.env.EXT_ID || 'fignfifoniblkonapihmkfakmlgkbkcf';

const list = await fetch(`http://127.0.0.1:${PORT}/json/list`).then((r) => r.json());
console.log(
  'targets',
  list.map((t) => ({ type: t.type, url: t.url, title: t.title })),
);

async function connect(url) {
  const ws = new WebSocket(url);
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
  return { ws, send };
}

const page =
  list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl) ||
  list.find((t) => t.webSocketDebuggerUrl);
if (!page) {
  console.error('no page target');
  process.exit(1);
}

const { ws, send } = await connect(page.webSocketDebuggerUrl);
await send('Page.enable');
await send('Runtime.enable');

const popup = `chrome-extension://${EXT_ID}/src/popup/index.html`;
await send('Page.navigate', { url: popup });
await new Promise((r) => setTimeout(r, 3000));

const info = await send('Runtime.evaluate', {
  expression:
    '({href:location.href,title:document.title,text:(document.body&&document.body.innerText||\"\").slice(0,1500),hasRoot:!!document.getElementById(\"root\")})',
  returnByValue: true,
});
console.log('POPUP', JSON.stringify(info.result?.value ?? info, null, 2));

// Read chrome.storage.local via extension page context
const storage = await send('Runtime.evaluate', {
  expression: `new Promise((resolve) => {
    try {
      chrome.storage.local.get(null, (data) => resolve({ ok: true, keys: Object.keys(data||{}), searchMarketplaces: data?.searchMarketplaces ?? data?.settings?.searchMarketplaces ?? null, rawSnippet: JSON.stringify(data||{}).slice(0,2000) }));
    } catch (e) {
      resolve({ ok: false, error: String(e) });
    }
  })`,
  awaitPromise: true,
  returnByValue: true,
});
console.log('STORAGE', JSON.stringify(storage.result?.value ?? storage, null, 2));

ws.close();
