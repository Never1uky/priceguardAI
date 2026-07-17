/** Уровень доступа пользователя */
export type SubscriptionTier = 'free' | 'premium';

export interface SubscriptionState {
  tier: SubscriptionTier;
  /** Когда активирован премиум */
  activatedAt?: number;
  /** Для подписки — дата окончания; для lifetime — undefined */
  expiresAt?: number;
  /** Лицензионный ключ (хранится локально) */
  licenseKey?: string;
  /** Источник активации */
  source?: 'license' | 'dev' | 'supabase' | 'trial';
}

/** Лимиты бесплатной версии */
export const FREE_LIMITS = {
  /** Отслеживаемые товары (план: 3–5, верхняя граница) */
  maxTrackedProducts: 5,
  maxCompareProducts: 5,
  /** @deprecated используйте maxAiRequestsPerDay */
  maxReviewAnalysesPerMonth: 5,
  /** AI-анализов в сутки (полный анализ + облачные отзывы) для Free */
  maxAiRequestsPerDay: 3,
  /** Полный AI-анализ доступен Free в рамках дневного лимита */
  fullAnalysisEnabled: true,
  /** Алерты о падении цены — Free: да (в пределах лимита товаров) */
  maxPriceAlerts: 5,
  maxMarketplacesCompare: 3,
} as const;

/**
 * План уведомлений:
 * Free — до N товаров, алерты да
 * Premium — без лимита, алерты + приоритет серверной проверки
 */
export const ALERT_PLAN = {
  free: {
    maxTracked: FREE_LIMITS.maxTrackedProducts,
    alerts: true,
    priority: false,
    label: 'Алерты · до 5 товаров',
  },
  premium: {
    maxTracked: Infinity,
    alerts: true,
    priority: true,
    label: 'Алерты · без лимита · приоритет',
  },
} as const;

/** Длительность пробного периода Premium */
export const TRIAL_DAYS = 7;

export const PREMIUM_PLANS = {
  monthly: {
    id: 'monthly' as const,
    label: '1 месяц',
    priceRub: 299,
    period: 'мес',
    description: 'Полный доступ на 30 дней',
    highlight: false,
  },
  yearly: {
    id: 'yearly' as const,
    label: '1 год',
    priceRub: 2490,
    period: 'год',
    description: 'Экономия ~30% против помесячной оплаты',
    highlight: true,
    savingsPercent: 30,
    /** Эквивалент помесячно */
    monthlyEquivalentRub: 208,
  },
  /** Сохраняем для старых лицензий / демо-ключей LIFE */
  lifetime: {
    id: 'lifetime' as const,
    label: 'Навсегда',
    priceRub: 2990,
    period: 'разово',
    description: 'Одна оплата — без ограничений по времени',
    highlight: false,
  },
} as const;

/** Тарифы, которые показываем в UI оплаты */
export const CHECKOUT_PLAN_IDS = ['monthly', 'yearly'] as const;

export type PremiumPlanId = keyof typeof PREMIUM_PLANS;
export type CheckoutPlanId = (typeof CHECKOUT_PLAN_IDS)[number];
