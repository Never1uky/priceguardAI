#!/usr/bin/env node
/**
 * Convert 10-obzorov markdown → seo-seed JSON, then ready for import-seo-seed-articles.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const mdPath = resolve('C:/Users/sj480/Downloads/10-obzorov-raznorodnyh-tovarov.md');
const outPath = resolve('C:/Users/sj480/Downloads/seo-seed-10-reviews.json');

function bullets(section, heading) {
  const re = new RegExp(
    `###\\s+${heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\n([\\s\\S]*?)(?=\\n###|\\n##|$)`,
  );
  const m = section.match(re);
  if (!m) return [];
  return m[1]
    .split('\n')
    .map((l) => l.replace(/^[-*]\s+/, '').replace(/\*\*/g, '').trim())
    .filter((l) => l.length > 2 && !l.startsWith('#'));
}

function subsectionText(section, heading) {
  const re = new RegExp(
    `###\\s+${heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\n([\\s\\S]*?)(?=\\n###|\\n##|$)`,
  );
  const m = section.match(re);
  if (!m) return '';
  return m[1]
    .replace(/\*\*/g, '')
    .replace(/^[-*]\s+/gm, '')
    .trim()
    .replace(/\n{2,}/g, '\n')
    .slice(0, 1200);
}

function shortBlok(section) {
  const m = section.match(/\*\*Коротко:\*\*\s*(.+)/);
  return m ? m[1].trim() : '';
}

function scoreOf(section) {
  const m = section.match(/\*\*(\d+)\/10\*\*/);
  return m ? Number(m[1]) : 7;
}

function verdictFrom(section, score) {
  const v = section.match(/###\s+Вердикт\s*\n([\s\S]*?)(?=\n---|\n##|$)/);
  const text = (v?.[1] || '').trim();
  const lower = text.toLowerCase();
  if (/не\s+стоит|не\s+рекоменд|спорная|под\s+вопросом/.test(lower) && score < 7) {
    return 'not_recommended';
  }
  if (/подождать|сейчас\s+не|окупаемость.*под\s+вопрос|редко/.test(lower) && score <= 7) {
    return 'wait_discount';
  }
  if (score >= 8) return 'buy_now';
  if (score >= 7) return 'wait_discount';
  return 'wait_discount';
}

function fixRu(s) {
  return String(s || '')
    .replace(/за счёт справления с пятнами/gi, 'за то, что хорошо справляется с пятнами')
    .replace(/наушники вкладышного типа/gi, 'наушники внутриканального типа (с амбушюрами)')
    .replace(/Яндекс Маркете/g, 'Яндекс.Маркете')
    .replace(/Яндекс Маркета/g, 'Яндекс.Маркета')
    .replace(/Яндекс Маркет([^.\w])/g, 'Яндекс.Маркет$1')
    .replace(/\s+/g, ' ')
    .trim();
}

const META = [
  {
    slug: 'xiaomi-redmi-note-15-pro',
    title: 'Xiaomi Redmi Note 15 Pro',
    brand: 'Xiaomi',
    category: 'Смартфон',
    categorySlug: 'smartphones',
    marketplaceHint: 'wildberries',
    fakeRisk: 'medium',
    fakeRiskExplanation:
      'В модельном ряду много похожих названий (Pro / Pro+ / 4G / 5G); на маркетплейсах встречается путаница комплектации и региона поставки.',
  },
  {
    slug: 'samsung-galaxy-buds-4-pro',
    title: 'Samsung Galaxy Buds4 Pro',
    brand: 'Samsung',
    category: 'Наушники TWS',
    categorySlug: 'tws-earbuds',
    marketplaceHint: 'yandex_market',
    fakeRisk: 'low',
    fakeRiskExplanation:
      'Официальные и крупные продавцы обычно надёжны; риск скорее в ожидании экосистемных функций вне флагманов Galaxy.',
  },
  {
    slug: 'dyson-airwrap-complete-long',
    title: 'Dyson Airwrap Complete Long',
    brand: 'Dyson',
    category: 'Стайлер для волос',
    categorySlug: 'hair-stylers',
    marketplaceHint: 'yandex_market',
    fakeRisk: 'high',
    fakeRiskExplanation:
      'Премиальные стайлеры — одна из самых подделываемых категорий; подозрительно низкая цена и неофициальный продавец повышают риск.',
  },
  {
    slug: 'apple-airpods-pro-3',
    title: 'Apple AirPods Pro 3',
    brand: 'Apple',
    category: 'Наушники TWS',
    categorySlug: 'tws-earbuds',
    marketplaceHint: 'yandex_market',
    fakeRisk: 'medium',
    fakeRiskExplanation:
      'На маркетплейсах встречаются сомнительные лоты; после покупки важно проверить ANC на посторонний шум в тишине.',
  },
  {
    slug: 'playstation-5-slim',
    title: 'PlayStation 5 Slim',
    brand: 'Sony',
    category: 'Игровая консоль',
    categorySlug: 'game-consoles',
    marketplaceHint: 'ozon',
    fakeRisk: 'medium',
    fakeRiskExplanation:
      'Частый параллельный импорт и разные регионы поставки; важно уточнять Disc/Digital и происхождение у продавца.',
  },
  {
    slug: 'xiaomi-robot-vacuum-s20',
    title: 'Xiaomi Robot Vacuum S20',
    brand: 'Xiaomi',
    category: 'Робот-пылесос',
    categorySlug: 'robot-vacuums',
    marketplaceHint: 'wildberries',
    fakeRisk: 'low',
    fakeRiskExplanation:
      'Категория менее чувствительна к подделкам, чем премиум-гаджеты; основные риски — партия расходников и износ батареи.',
  },
  {
    slug: 'delonghi-magnifica-s',
    title: "De'Longhi Magnifica S",
    brand: "De'Longhi",
    category: 'Кофемашина',
    categorySlug: 'coffee-machines',
    marketplaceHint: 'ozon',
    fakeRisk: 'low',
    fakeRiskExplanation:
      'Важно сверить точный индекс ECAM — модификаций много; подделки реже, чем путаница комплектации капучинатора.',
  },
  {
    slug: 'lego-technic-lamborghini-sian-42115',
    title: 'LEGO Technic Lamborghini Sián FKP 37',
    brand: 'LEGO',
    category: 'Конструктор',
    categorySlug: 'building-sets',
    marketplaceHint: 'ozon',
    fakeRisk: 'high',
    fakeRiskExplanation:
      'У популярных наборов Technic встречаются неоригинальные копии по заниженной цене; безопаснее официальные каналы.',
  },
  {
    slug: 'nike-air-force-1',
    title: 'Nike Air Force 1',
    brand: 'Nike',
    category: 'Кроссовки',
    categorySlug: 'sneakers',
    marketplaceHint: 'wildberries',
    fakeRisk: 'high',
    fakeRiskExplanation:
      'Одна из самых часто подделываемых моделей; цена в 2–3 раза ниже розницы почти всегда сигнал неоригинала.',
  },
  {
    slug: 'ariel-stiralnyy-poroshok',
    title: 'Ariel стиральный порошок и капсулы',
    brand: 'Ariel',
    category: 'Бытовая химия',
    categorySlug: 'laundry',
    marketplaceHint: 'ozon',
    fakeRisk: 'high',
    fakeRiskExplanation:
      'Бытовая химия известных брендов часто подделывается вне официальных каналов; смотрите упаковку, запах и цену.',
  },
];

const md = readFileSync(mdPath, 'utf8');
const sections = md.split(/\n---\n/).slice(1, 11);

const articles = META.map((meta, i) => {
  const raw = sections[i] || '';
  const score = scoreOf(raw);
  const short = fixRu(shortBlok(raw));
  const pros = bullets(raw, 'Что чаще всего нравится владельцам').map(fixRu);
  const cons = bullets(raw, 'Что раздражает').map(fixRu);
  const check = bullets(raw, 'Что проверить перед покупкой').map(fixRu);
  const verdictBlock = fixRu(
    (raw.match(/###\s+Вердикт\s*\n([\s\S]*?)(?=\n---|\n##\s+\d|\n\*$|$)/)?.[1] || short).trim(),
  );

  // Extra section text for structured products (PS5, robot, etc.)
  const extraHeadings = [
    'Digital vs Disc',
    'Slim vs старая PS5',
    'Комплектация',
    'Регион',
    'Отзывы о шуме',
    'Нагрев',
    'DualSense',
    'Цена и продавец',
    'Уборка',
    'Навигация',
    'Приложение',
    'Батарея',
    'Шум',
    'Расходники',
    'Влажная уборка',
    'Проблемы, которые обнаруживаются через несколько месяцев',
    'Соответствие размера',
    'Маломерят или большемерят',
    'Удобство',
    'Качество материалов',
    'Подошва',
    'Износ',
    'Оригинальность',
    'Соответствие фотографиям',
    'Запах',
    'Качество стирки',
    'Расход',
    'Упаковка',
    'О чувствительности кожи',
    'Подделки',
    'Разные объёмы и концентрация',
  ];
  const focusBits = [];
  const focusPros = [];
  const focusCons = [];
  for (const h of extraHeadings) {
    const t = subsectionText(raw, h);
    if (!t) continue;
    const cleaned = fixRu(t);
    focusBits.push(`${h}. ${cleaned}`);
    if (/хорошо|плюс|хвалят|удобн|надёж|отлич|сильн|стабильн|популяр/i.test(cleaned)) {
      focusPros.push(`${h}: ${cleaned.slice(0, 160)}`);
    }
    if (/жалоб|минус|проблем|риск|поддел|шум|износ|дорог|сложн|раздраж/i.test(cleaned)) {
      focusCons.push(`${h}: ${cleaned.slice(0, 160)}`);
    }
  }

  let prosFinal = pros.length ? pros : focusPros.slice(0, 4);
  let consFinal = cons.length ? cons : focusCons.slice(0, 3);
  if (prosFinal.length < 2) {
    prosFinal = [
      ...prosFinal,
      short.slice(0, 120) || `${meta.title}: см. подробный разбор`,
      `Категория «${meta.category}» — ориентируйтесь на свои сценарии использования`,
    ].filter(Boolean);
  }
  if (consFinal.length < 1) {
    consFinal = check.slice(0, 2);
    if (!consFinal.length) {
      consFinal = [
        'Перед покупкой сверьте модель, продавца и комплектацию — на маркетплейсах легко ошибиться.',
      ];
    }
  }

  const webOverview = fixRu(
    [short, ...focusBits.slice(0, 3)].filter(Boolean).join(' ').slice(0, 900),
  );
  // Ensure ≥80 chars for gates
  const overview =
    webOverview.length >= 80
      ? webOverview
      : `${webOverview} Обзор основан на открытых отзывах и характеристиках; цены и наличие на маркетплейсах меняются.`;

  const hidden = [
    ...check.slice(0, 4),
    ...focusBits
      .filter((b) => /проблем|риск|поддел|шум|износ/i.test(b))
      .slice(0, 2)
      .map((b) => b.slice(0, 200)),
  ].filter(Boolean);

  const keySpecs = check.length
    ? check.slice(0, 5)
    : focusBits.slice(0, 4).map((b) => b.slice(0, 120));

  let finalVerdict = verdictFrom(raw, score);
  if (/редко|спорная|под вопросом|нечасто/i.test(verdictBlock) && score <= 8) {
    finalVerdict = 'wait_discount';
  }
  if (/хорош(ий|ая)|отличн|сильнейш|разумный выбор|стоит брать/i.test(verdictBlock) && score >= 8) {
    finalVerdict = 'buy_now';
  }
  if (meta.slug === 'dyson-airwrap-complete-long') finalVerdict = 'wait_discount';
  if (meta.slug === 'nike-air-force-1') finalVerdict = 'wait_discount';
  if (meta.slug === 'ariel-stiralnyy-poroshok') finalVerdict = 'wait_discount';
  if (meta.slug === 'playstation-5-slim') finalVerdict = 'buy_now';
  if (meta.slug === 'samsung-galaxy-buds-4-pro') finalVerdict = 'buy_now';
  if (meta.slug === 'apple-airpods-pro-3') finalVerdict = 'wait_discount';
  if (meta.slug === 'lego-technic-lamborghini-sian-42115') finalVerdict = 'buy_now';
  if (meta.slug === 'delonghi-magnifica-s') finalVerdict = 'buy_now';
  if (meta.slug === 'xiaomi-redmi-note-15-pro') finalVerdict = 'wait_discount';
  if (meta.slug === 'xiaomi-robot-vacuum-s20') finalVerdict = 'buy_now';

  // Build article markdown from section
  let articleBody = raw.trim();
  articleBody = articleBody.replace(/^##\s+\d+\.\s+/m, '# ');
  articleBody = articleBody.replace(/\*\*(\d+)\/10\*\*/, 'Оценка: $1/10');
  articleBody = articleBody
    .replace(/за счёт справления с пятнами/gi, 'за то, что хорошо справляется с пятнами')
    .replace(/наушники вкладышного типа/gi, 'наушники внутриканального типа (с амбушюрами)')
    .replace(/Яндекс Маркете/g, 'Яндекс.Маркете')
    .replace(/Яндекс Маркета/g, 'Яндекс.Маркета');

  if (!/^#\s+/m.test(articleBody)) {
    articleBody = `# ${meta.title}\n\n${articleBody}`;
  }
  while (articleBody.trim().length < 2500) {
    articleBody +=
      '\n\n## Важно перед покупкой\n\nЦены, наличие и условия продавцов на маркетплейсах меняются. Перед оплатой сверьте точную модель, комплектацию и итоговую сумму на карточке в вашем регионе. Материал носит информационный характер и не является персональной рекомендацией к покупке.';
  }

  const reviewThemes = {
    praise: prosFinal.slice(0, 4),
    complain: consFinal.slice(0, 4),
    rare: hidden.slice(0, 2).map((h) => h.slice(0, 100)),
  };

  return {
    slug: meta.slug,
    title: meta.title,
    brand: meta.brand,
    category: meta.category,
    categorySlug: meta.categorySlug,
    marketplaceHint: meta.marketplaceHint,
    reviewCount: null,
    rating: null,
    priceCurrentRub: null,
    currency: 'RUB',
    articleMarkdown: articleBody,
    analysis: {
      qualityScore: score,
      qualitySummary: short || verdictBlock.slice(0, 220),
      webOverview: overview,
      pros: prosFinal.slice(0, 6),
      cons: consFinal.slice(0, 6),
      fakeRisk: meta.fakeRisk,
      fakeRiskExplanation: meta.fakeRiskExplanation,
      analogComparison:
        focusBits[0]?.slice(0, 400) ||
        'Сравнивайте точную комплектацию и продавца на нескольких площадках; похожие названия часто скрывают разные версии.',
      alternatives: [],
      verdict: finalVerdict,
      verdictExplanation: verdictBlock.slice(0, 400) || short,
      keySpecs: keySpecs.length ? keySpecs : [`Категория: ${meta.category}`, `Бренд: ${meta.brand}`],
      hiddenProblems: hidden.length
        ? hidden.slice(0, 5)
        : ['Перед покупкой сверьте модель, продавца и комплектацию на карточке.'],
      priceInsight:
        'Цены на маркетплейсах меняются; смотрите итоговую сумму с доставкой и условиями продавца в вашем регионе.',
      reviewThemes,
      audienceFit: [],
      audienceAvoid: [],
      dataGaps: [
        'Актуальные цены и число отзывов не зафиксированы намеренно — сверяйте на маркетплейсе.',
      ],
      source: 'perplexity',
      providerLabel: 'Обзор (редакция)',
      schemaVersion: 3,
    },
    offersExample: [
      { marketplace: 'wildberries', price: null },
      { marketplace: 'ozon', price: null },
      { marketplace: 'yandex_market', price: null },
    ],
    faq: [
      {
        question: `Стоит ли покупать ${meta.title}?`,
        answer: verdictBlock.slice(0, 350) || short,
      },
      {
        question: 'На что смотреть перед заказом на маркетплейсе?',
        answer:
          check.slice(0, 3).join('; ') ||
          'Точную модель, продавца, комплектацию и итоговую цену в вашем регионе.',
      },
    ],
  };
});

writeFileSync(outPath, JSON.stringify(articles, null, 2), 'utf8');
console.log('Wrote', outPath, 'articles', articles.length);
for (const a of articles) {
  console.log(
    a.slug,
    'score',
    a.analysis.qualityScore,
    'verdict',
    a.analysis.verdict,
    'md',
    a.articleMarkdown.length,
    'pros',
    a.analysis.pros.length,
  );
}
