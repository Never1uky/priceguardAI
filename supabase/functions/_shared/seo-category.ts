/**
 * Lightweight ProductCategory infer for SEO publish (no full match stack).
 * Order mirrors CATEGORY_PLUGINS: first match wins; generic → null (no hub).
 */

export type SeoProductCategoryId =
  | 'accessories'
  | 'tvs'
  | 'monitors'
  | 'smartphones'
  | 'gpus'
  | 'desktops'
  | 'laptops'
  | 'headphones'
  | 'wearables'
  | 'lenses'
  | 'cameras'
  | 'consoles'
  | 'networking'
  | 'power_tools'
  | 'appliances'
  | 'home_textile'
  | 'home_goods'
  | 'kids'
  | 'sports'
  | 'shoes'
  | 'apparel'
  | 'detergents'
  | 'cosmetics'
  | 'pet_food';

export interface SeoCategoryInfo {
  id: SeoProductCategoryId;
  slug: string;
  labelRu: string;
}

const LABEL_RU: Record<SeoProductCategoryId, string> = {
  accessories: 'Аксессуары',
  tvs: 'Телевизоры',
  monitors: 'Мониторы',
  smartphones: 'Смартфоны',
  gpus: 'Видеокарты',
  desktops: 'ПК',
  laptops: 'Ноутбуки',
  headphones: 'Наушники',
  wearables: 'Гаджеты',
  lenses: 'Объективы',
  cameras: 'Фотоаппараты',
  consoles: 'Игровые приставки',
  networking: 'Сеть',
  power_tools: 'Инструменты',
  appliances: 'Бытовая техника',
  home_textile: 'Текстиль',
  home_goods: 'Товары для дома',
  kids: 'Детские товары',
  sports: 'Спорт',
  shoes: 'Обувь',
  apparel: 'Одежда',
  detergents: 'Бытовая химия',
  cosmetics: 'Косметика',
  pet_food: 'Корм для животных',
};

/** Slug = id (stable, ASCII). */
export function seoCategoryInfo(id: SeoProductCategoryId): SeoCategoryInfo {
  return { id, slug: id, labelRu: LABEL_RU[id] };
}

type Rule = { id: SeoProductCategoryId; patterns: RegExp[] };

/** First hit wins — keep in sync with src/lib/category-plugins.ts order. */
const RULES: Rule[] = [
  {
    id: 'accessories',
    patterns: [
      /\bdual\s*sense\b/i,
      /\bdualshock\b/i,
      /геймпад|джойстик/i,
      /(?:чехол|защитн\w*\s+(?:стекл|плёнк|пленк)|кабель\s+(?:usb|type|type-c|lightning)|зарядк)/i,
      /чехол\s+для\s+(?:iphone|galaxy|samsung|xiaomi|redmi|телефон|смартфон|ноут)/i,
    ],
  },
  {
    id: 'tvs',
    patterns: [/телевизор/i, /\bsmart\s*tv\b/i, /\bOLED\s*(?:TV|телевизор)/i, /\bQLED\b/i],
  },
  {
    id: 'monitors',
    patterns: [/монитор/i, /\bmonitor\b/i, /\bgaming\s+monitor\b/i],
  },
  {
    id: 'smartphones',
    patterns: [/смартфон/i, /\bsmartphone\b/i, /\biphone\b/i, /\bgalaxy\s*s\d/i, /\bredmi\s+note\b/i],
  },
  {
    id: 'gpus',
    patterns: [/видеокарт/i, /\bgpu\b/i, /\brtx\s*\d{4}/i, /\bgtx\s*\d{4}/i, /radeon\s+rx/i],
  },
  {
    id: 'desktops',
    patterns: [/системн\w*\s*блок/i, /игровой\s+компьютер/i, /пк\s+сборк/i, /\bdesktop\b/i],
  },
  {
    id: 'laptops',
    patterns: [/ноутбук/i, /\blaptop\b/i, /\bmacbook\b/i, /\bnotebook\b/i, /\bultrabook\b/i],
  },
  {
    id: 'headphones',
    patterns: [
      /наушник/i,
      /\bheadphones?\b/i,
      /\bearbuds?\b/i,
      /\bairpods\b/i,
      /\bgalaxy\s*buds/i,
      /\bheadset\b/i,
      /\bbuds\b/i,
    ],
  },
  {
    id: 'wearables',
    patterns: [
      /умные\s+часы/i,
      /фитнес\s*[-\s]?браслет/i,
      /smart\s*band/i,
      /\bamazfit\b/i,
      /\bmi\s*band\b/i,
      /\bgalaxy\s*watch\b/i,
      /\bapple\s*watch\b/i,
    ],
  },
  {
    id: 'lenses',
    patterns: [/объектив/i, /\blens\b/i, /\b\d{1,3}[-–]\d{2,3}\s*mm\b/i],
  },
  {
    id: 'cameras',
    patterns: [/фотоаппарат/i, /\bcamera\b/i, /\bdslr\b/i, /\bmirrorless\b/i, /\beos\s*\d{3,4}/i],
  },
  {
    id: 'consoles',
    patterns: [
      /игрово\w*\s+приставк/i,
      /\bplaystation\b/i,
      /\bps\s*[45]\b/i,
      /\bxbox\b/i,
      /nintendo\s+switch/i,
    ],
  },
  {
    id: 'networking',
    patterns: [/роутер/i, /маршрутизатор/i, /\brouter\b/i, /mesh\s+wifi/i, /wifi\s*6/i],
  },
  {
    id: 'power_tools',
    patterns: [/шуруповёрт|шуруповерт/i, /перфоратор/i, /болгарк/i, /электроинструмент/i],
  },
  {
    id: 'appliances',
    patterns: [
      /стиральн\w*\s+машин/i,
      /холодильник/i,
      /пылесос/i,
      /микроволнов/i,
      /кофемашин/i,
      /воздухоочиститель/i,
    ],
  },
  {
    id: 'home_textile',
    patterns: [/постельн\w*\s+бель/i, /полотенц/i, /плед/i, /одеяло/i, /наволочк/i],
  },
  {
    id: 'home_goods',
    patterns: [/кастрюл/i, /сковород/i, /посуд/i, /органайзер/i, /для\s+дома/i],
  },
  {
    id: 'kids',
    patterns: [/детск/i, /подгузник/i, /для\s+малыш/i, /коляск/i],
  },
  {
    id: 'sports',
    patterns: [/протеин/i, /гантел/i, /штанга/i, /коврик\s+для\s+(?:йог|фитнес)/i, /фитнес/i],
  },
  {
    id: 'shoes',
    patterns: [/кроссовк/i, /ботинк/i, /туфл/i, /\bsneakers?\b/i, /обувь/i, /кеды/i],
  },
  {
    id: 'apparel',
    patterns: [/футболк/i, /худи/i, /свитшот/i, /куртк/i, /джинс/i, /платье/i, /рубашк/i, /одежда/i],
  },
  {
    id: 'detergents',
    patterns: [/порошок/i, /гель\s+для\s+стирк/i, /\bfairy\b/i, /\bpersil\b/i, /\bariel\b/i],
  },
  {
    id: 'cosmetics',
    patterns: [/шампунь/i, /тушь/i, /помад/i, /косметик/i, /парфюм/i, /духи/i, /крем\s+для\s+лица/i],
  },
  {
    id: 'pet_food',
    patterns: [/корм\s+для/i, /сухой\s+корм/i, /влажный\s+корм/i],
  },
];

/**
 * Infer SEO category from title. Returns null for generic / unknown
 * (do not create junk hubs).
 */
export function inferSeoCategoryFromTitle(title: string): SeoCategoryInfo | null {
  const text = title?.trim() ?? '';
  if (!text) return null;
  for (const rule of RULES) {
    if (rule.patterns.some((re) => re.test(text))) {
      return seoCategoryInfo(rule.id);
    }
  }
  return null;
}
