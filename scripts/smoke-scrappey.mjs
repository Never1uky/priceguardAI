#!/usr/bin/env node
/**
 * Live smoke: Scrappey → HTML → price parse for Ozon / YM / WB sample URLs.
 * Usage: SCRAPPEY_API_KEY=... node scripts/smoke-scrappey.mjs
 */

const API_KEY = process.env.SCRAPPEY_API_KEY?.trim();
if (!API_KEY) {
  console.error('Set SCRAPPEY_API_KEY');
  process.exit(1);
}

const SAMPLES = [
  {
    name: 'ozon',
    url: 'https://www.ozon.ru/product/smartfon-apple-iphone-15-128gb-1234567890/',
    parse: parseOzon,
  },
  {
    name: 'yandex_market',
    url: 'https://market.yandex.ru/product--test/12345678',
    parse: parseYm,
  },
  {
    name: 'wildberries',
    url: 'https://www.wildberries.ru/catalog/211062976/detail.aspx',
    parse: parseWb,
  },
];

async function scrappeyGet(url, requestType = 'request') {
  const started = Date.now();
  const res = await fetch(`https://publisher.scrappey.com/api/v1?key=${encodeURIComponent(API_KEY)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      cmd: 'request.get',
      url,
      proxyCountry: 'Russia',
      requestType,
    }),
  });
  const json = await res.json();
  const elapsed = Date.now() - started;
  if (json.data !== 'success') {
    return { ok: false, elapsed, error: json.error ?? json.data, mode: requestType };
  }
  const html = json.solution?.response ?? '';
  if (!html || html.length < 80) {
    return { ok: false, elapsed, error: 'empty_body', mode: requestType };
  }
  if (/Access Denied|challenge|captcha|showcaptcha/i.test(html) && html.length < 40_000) {
    if (requestType === 'request') {
      return scrappeyGet(url, 'browser');
    }
    return { ok: false, elapsed, error: 'still_blocked', mode: requestType };
  }
  return { ok: true, elapsed, html, mode: requestType };
}

function parseOzon(html) {
  const m =
    html.match(/itemprop=["']price["'][^>]*content=["'](\d+(?:\.\d+)?)["']/i) ||
    html.match(/"price"\s*:\s*"?(?:RUB\s*)?(\d{3,7})"?/i);
  return m ? Math.round(Number(m[1])) : null;
}

function parseYm(html) {
  if (/showcaptcha/i.test(html)) return null;
  const m = html.match(/"prices"\s*:\s*\{[^}]{0,120}"value"\s*:\s*"?(\d+)/);
  if (m) return parseInt(m[1], 10);
  const ld = html.match(/"price"\s*:\s*"?(\d{3,7})"?/i);
  return ld ? parseInt(ld[1], 10) : null;
}

function parseWb(html) {
  const sale = html.match(/"salePriceU"\s*:\s*(\d+)/);
  const basic = html.match(/"priceU"\s*:\s*(\d+)/);
  const raw = sale?.[1] ?? basic?.[1];
  if (!raw) return null;
  const n = Number(raw);
  return n >= 1000 ? Math.round(n / 100) : n;
}

async function main() {
  const results = [];
  for (const sample of SAMPLES) {
    process.stdout.write(`[${sample.name}] fetching... `);
    try {
      const fetched = await scrappeyGet(sample.url);
      if (!fetched.ok) {
        console.log(`FAIL (${fetched.error}, ${fetched.mode}, ${fetched.elapsed}ms)`);
        results.push({ ...sample, ok: false, ...fetched });
        continue;
      }
      const price = sample.parse(fetched.html);
      const ok = price != null && price > 0;
      console.log(
        ok
          ? `OK price=${price} mode=${fetched.mode} ${fetched.elapsed}ms`
          : `FAIL parse (html ${fetched.html.length}b, mode=${fetched.mode})`,
      );
      results.push({ name: sample.name, ok, price, mode: fetched.mode, elapsed: fetched.elapsed });
    } catch (e) {
      console.log(`ERR ${e instanceof Error ? e.message : e}`);
      results.push({ name: sample.name, ok: false, error: String(e) });
    }
  }

  const passed = results.filter((r) => r.ok).length;
  console.log(`\nSmoke: ${passed}/${results.length} passed`);
  process.exit(passed === results.length ? 0 : 1);
}

main();
