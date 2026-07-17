/** Корзины WB по диапазону vol (актуальная схема CDN) */
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
  ];

  for (const [maxVol, host] of ranges) {
    if (vol <= maxVol) return host;
  }
  return '35';
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
  const primaryHost = getWbBasketHost(vol);

  const hosts = new Set([
    primaryHost,
    String((id % 10) + 1).padStart(2, '0'),
    '01',
    '14',
  ]);

  return [...hosts].map(
    (host) =>
      `https://basket-${host}.wbbasket.ru/vol${vol}/part${part}/${id}/images/big/1.webp`,
  );
}

export function isGenericWildberriesTitle(title: string): boolean {
  const lower = title.toLowerCase();
  return (
    lower.includes('интернет-магазин wildberries') ||
    lower.includes('широкий ассортимент') ||
    lower.includes('wildberries:') && title.length < 80 ||
    lower.startsWith('купить') && lower.includes('wildberries')
  );
}

export function isGenericOzonTitle(title: string): boolean {
  const lower = title.toLowerCase();
  return lower.includes('ozon') && title.length < 40 && !lower.includes(' ');
}
