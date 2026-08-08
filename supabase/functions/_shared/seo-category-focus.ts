/**
 * Category → focus axes for AI prompt + SEO uniqueness (P2).
 * Keep small; default axes when unknown.
 */

export interface CategoryFocus {
  slug: string;
  axes: string[];
}

const DEFAULT_AXES = ['качество', 'удобство', 'надёжность', 'цена и ценность'];

const BY_SLUG: Record<string, string[]> = {
  headphones: ['звук', 'автономность', 'ANC / шумодав', 'микрофон', 'посадка'],
  smartphones: ['экран', 'камера', 'батарея', 'производительность'],
  laptops: ['экран', 'производительность', 'батарея', 'клавиатура', 'охлаждение'],
  wearables: ['точность датчиков', 'автономность', 'удобство ремешка', 'уведомления'],
  tvs: ['картинка', 'звук', 'Smart TV', 'игровые режимы'],
  monitors: ['матрица', 'частота', 'яркость', 'эргономика'],
  gpus: ['производительность', 'шум', 'температура', 'потребление'],
  appliances: ['мощность / всасывание', 'автономность', 'фильтрация', 'удобство'],
  power_tools: ['мощность', 'эргономика', 'ресурс', 'аккумулятор'],
  apparel: ['посадка / размер', 'материал', 'качество пошива', 'износостойкость'],
  shoes: ['посадка / размер', 'материал', 'удобство', 'износостойкость'],
  cosmetics: ['эффект', 'состав', 'запах', 'расход'],
  detergents: ['эффективность', 'расход', 'запах', 'для каких тканей'],
  kids: ['безопасность', 'удобство', 'износостойкость', 'размер'],
  cameras: ['матрица', 'автофокус', 'видео', 'эргономика'],
  lenses: ['резкость', 'светосила', 'автофокус', 'совместимость'],
  consoles: ['производительность', 'шум', 'обратная совместимость', 'экосистема'],
  networking: ['скорость', 'покрытие', 'стабильность', 'настройка'],
  accessories: ['совместимость', 'качество сборки', 'удобство', 'износостойкость'],
  home_textile: ['материал', 'размер', 'износостойкость', 'уход'],
  home_goods: ['удобство', 'материалы', 'надёжность', 'размер'],
  sports: ['эффективность', 'удобство', 'измерения / состав', 'вкус / переносимость'],
  pet_food: ['состав', 'усвояемость', 'для кого', 'цена за порцию'],
  desktops: ['производительность', 'охлаждение', 'шум', 'апгрейд'],
};

export function focusAxesForCategorySlug(categorySlug: string | null | undefined): string[] {
  const key = (categorySlug ?? '').trim().toLowerCase();
  if (key && BY_SLUG[key]) return BY_SLUG[key];
  return DEFAULT_AXES;
}

/** One-line block for AI user prompt. */
export function formatFocusAxesPromptBlock(categorySlug: string | null | undefined): string {
  const axes = focusAxesForCategorySlug(categorySlug);
  return [
    'Сфокусируй pros/cons/keySpecs/reviewThemes на осях категории (если есть в отзывах/данных):',
    axes.map((a) => `  - ${a}`).join('\n'),
    'Не пиши про оси, которых нет в исходных данных. Не выдумывай характеристики.',
  ].join('\n');
}
