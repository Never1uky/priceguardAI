/** Корзины WB по диапазону vol (актуальная схема CDN). Ranges периодически расширяются. */
export function getWbBasketHost(vol: number): string {
  const ranges: Array<[number, string]> = [
    [143, '01'],
    [287, '02'],
    [431, '03'],
    [719, '04'],
    [1007, '05'],
    [1061, '06'],
    [1115, '07'],
    [1169, '08'],
    [1313, '09'],
    [1601, '10'],
    [1655, '11'],
    [1919, '12'],
    [2045, '13'],
    [2189, '14'],
    [2405, '15'],
    [2621, '16'],
    [2837, '17'],
    [3053, '18'],
    [3269, '19'],
    [3485, '20'],
    [3701, '21'],
    [3917, '22'],
    [4133, '23'],
    [4349, '24'],
    [4565, '25'],
    [4877, '26'],
    [5189, '27'],
    [5501, '28'],
    [5813, '29'],
    [6125, '30'],
    [6437, '31'],
    [6749, '32'],
    [7061, '33'],
    [7373, '34'],
    [7700, '35'],
    [8027, '36'],
    [8353, '37'],
    [8679, '38'],
    [9005, '39'],
    [9331, '40'],
    [9657, '41'],
    [9983, '42'],
    [10309, '43'],
    [10635, '44'],
    [10961, '45'],
    [11287, '46'],
    [11613, '47'],
    [11939, '48'],
    [12265, '49'],
    [12591, '50'],
    [12917, '51'],
    [13243, '52'],
    [13569, '53'],
    [13895, '54'],
    [14221, '55'],
  ];

  for (const [maxVol, host] of ranges) {
    if (vol <= maxVol) return host;
  }
  // Very new SKUs: keep climbing; UI will cycle alternatives
  const extra = Math.floor((vol - 14221) / 326) + 56;
  return String(Math.min(extra, 99)).padStart(2, '0');
}

export function buildWbImageUrl(nmId: string | number, photoIndex = 1): string {
  const id = Number(nmId);
  const vol = Math.floor(id / 100000);
  const part = Math.floor(id / 1000);
  const host = getWbBasketHost(vol);
  return `https://basket-${host}.wbbasket.ru/vol${vol}/part${part}/${id}/images/big/${photoIndex}.webp`;
}

export function buildWbImageUrlAlternatives(nmId: string | number): string[] {
  const id = Number(nmId);
  const vol = Math.floor(id / 100000);
  const part = Math.floor(id / 1000);
  const primaryHost = Number.parseInt(getWbBasketHost(vol), 10);
  const hosts = new Set<string>();

  const add = (n: number) => {
    if (n >= 1 && n <= 99) hosts.add(String(n).padStart(2, '0'));
  };

  add(primaryHost);
  for (let d = 1; d <= 6; d++) {
    add(primaryHost - d);
    add(primaryHost + d);
  }
  // Common shards + id-derived guess
  for (const n of [1, 10, 12, 14, 15, 18, 20, 25, 28, 30, 35, 40, 45, 50, (id % 20) + 1]) {
    add(n);
  }

  return [...hosts].map(
    (host) =>
      `https://basket-${host}.wbbasket.ru/vol${vol}/part${part}/${id}/images/big/1.webp`,
  );
}

export function isGenericWildberriesTitle(title: string): boolean {
  const lower = title.toLowerCase();
  return (
    /^товар на (wildberries|wb)$/i.test(title.trim()) ||
    lower.includes('интернет-магазин wildberries') ||
    lower.includes('широкий ассортимент') ||
    (lower.includes('wildberries:') && title.length < 80) ||
    (lower.startsWith('купить') && lower.includes('wildberries'))
  );
}

export function isGenericOzonTitle(title: string): boolean {
  const t = title.trim();
  const lower = t.toLowerCase();
  if (/^товар на ozon$/i.test(t)) return true;
  return lower.includes('ozon') && t.length < 40 && !lower.includes(' ');
}

export function isGenericYandexTitle(title: string): boolean {
  const t = title.trim().toLowerCase();
  return (
    t === 'товар на яндекс.маркет' ||
    t === 'товар на яндекс маркет' ||
    t === 'товар на я.маркет' ||
    t === 'товар на я маркет'
  );
}

/** Placeholder / marketplace shell titles — do not persist as product name. */
export function isGenericProductTitle(title: string | null | undefined): boolean {
  if (!title?.trim()) return true;
  const t = title.trim();
  if (t === 'Товар') return true;
  if (/^\d+\s*балл/i.test(t)) return true;
  return (
    isGenericWildberriesTitle(t) || isGenericOzonTitle(t) || isGenericYandexTitle(t)
  );
}

/** Prefer real title over marketplace placeholders. */
export function preferRealTitle(
  preferred: string | null | undefined,
  fallback: string | null | undefined,
  lastResort = 'Товар',
): string {
  if (preferred?.trim() && !isGenericProductTitle(preferred)) return preferred.trim();
  if (fallback?.trim() && !isGenericProductTitle(fallback)) return fallback.trim();
  if (preferred?.trim()) return preferred.trim();
  if (fallback?.trim()) return fallback.trim();
  return lastResort;
}
