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
  /**
   * Единый лимит «Мои товары» (следить + сравнивать в одном слоте).
   * maxTrackedProducts / maxCompareProducts оставлены как алиасы для совместимости.
   */
  maxMyProducts: 5,
  /** @deprecated используйте maxMyProducts */
  maxTrackedProducts: 5,
  /** @deprecated используйте maxMyProducts */
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

/** Лимиты Premium / trial (AI без дневного freemium-cap; товары — потолок) */
export const PREMIUM_LIMITS = {
  maxMyProducts: 50,
  maxTrackedProducts: 50,
  maxCompareProducts: 50,
  maxPriceAlerts: 50,
} as const;

/**
 * План уведомлений:
 * Free — до N товаров, алерты да
 * Premium — до PREMIUM_LIMITS, алерты + приоритет серверной проверки
 */
export const ALERT_PLAN = {
  free: {
    maxTracked: FREE_LIMITS.maxMyProducts,
    alerts: true,
    priority: false,
    label: 'Алерты · до 5 товаров',
  },
  premium: {
    maxTracked: PREMIUM_LIMITS.maxMyProducts,
    alerts: true,
    priority: true,
    label: 'Алерты · до 50 товаров · приоритет',
  },
} as const;

/** Длительность пробного периода Premium (дней). Sync with Edge claim-trial TRIAL_DAYS. */
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
