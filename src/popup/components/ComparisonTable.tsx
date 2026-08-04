import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { formatPrice, paymentDiscountLabel } from '@/lib/utils';
import { isOfferWithPrice, normalizeMarketplaceRating } from '@/lib/compare-offers';
import { findCheapestOffer } from '@/lib/marketplace-search';
import { isProductPageUrl, getMatchWarnKind } from '@/lib/product-match';
import {
  matchStatusShortHint,
  offerMatchStatus,
  type MatchStatus,
} from '@/lib/match-status';
import { SEARCHING_MP_CROSS } from '@/lib/compare-jobs';
import {
  COMPARISON_MARKETPLACE_LABELS,
  type ComparisonMarketplace,
  type MarketplaceOffer,
  type SearchCandidateOffer,
} from '@/types/comparison';
import { ProductLink } from '@/popup/components/ProductLink';
import { ProductImage } from '@/popup/components/ProductImage';
import { safeMarketplaceHref } from '@/utils/safe-marketplace-url';
import { ExternalLink, Link2, Loader2, Star, Trophy, XCircle, Check, Search, ChevronDown, X } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { errorSuggestsVpnHint, VPN_SEARCH_HINT } from '@/lib/ozon-serp-dom';
import { sanitizeCandidateTitle } from '@/lib/serp-title';

interface ComparisonTableProps {
  offers: MarketplaceOffer[];
  /** Compare product id — for dismiss key persistence */
  productId?: string;
  referenceTitle?: string;
  referenceSpecs?: string;
  sourceMarketplace?: ComparisonMarketplace;
  isLoading?: boolean;
  searchingMarketplace?: ComparisonMarketplace | typeof SEARCHING_MP_CROSS | null;
  onManualLink?: (marketplace: ComparisonMarketplace, url: string) => Promise<void>;
  onRejectOffer?: (marketplace: ComparisonMarketplace, rejectedUrl: string) => Promise<void>;
  /** Отклонить кандидата из needs_choice picker (без auto-bind). */
  onRejectCandidate?: (marketplace: ComparisonMarketplace, rejectedUrl: string) => Promise<void>;
  onSelectCandidate?: (
    marketplace: ComparisonMarketplace,
    url: string,
    hint?: { title?: string; price?: number | null; rating?: number | null },
  ) => Promise<void>;
  /** Local CTA for not_found / antibot cells — research only this marketplace. */
  onResearchMarketplace?: (marketplace: ComparisonMarketplace) => void;
  linkingMarketplace?: ComparisonMarketplace | null;
  rejectingMarketplace?: ComparisonMarketplace | null;
  selectingMarketplace?: ComparisonMarketplace | null;
  /** Persisted rejected URLs per marketplace (visual + disable re-reject). */
  rejectedOfferUrls?: Partial<Record<ComparisonMarketplace, string[]>>;
}

const marketplaceBadgeVariant: Record<
  ComparisonMarketplace,
  'wildberries' | 'ozon' | 'yandex'
> = {
  wildberries: 'wildberries',
  ozon: 'ozon',
  yandex_market: 'yandex',
};

const marketplaceShortLabel: Record<ComparisonMarketplace, string> = {
  wildberries: 'WB',
  ozon: 'Ozon',
  yandex_market: 'Я.Маркет',
};

const marketplaceUrlPlaceholder: Record<ComparisonMarketplace, string> = {
  wildberries: 'https://www.wildberries.ru/catalog/...',
  ozon: 'https://www.ozon.ru/product/...',
  yandex_market: 'https://market.yandex.ru/product/...',
};

const MATCH_WARN_DISMISS_KEY = 'priceguard_match_warn_dismissed';

const STATUS_STYLES: Record<MatchStatus, string> = {
  verified:
    'bg-green-100 text-green-800 dark:bg-green-500/20 dark:text-green-300',
  probable:
    'bg-amber-100 text-amber-900 dark:bg-amber-500/20 dark:text-amber-200',
  needs_choice:
    'bg-red-100 text-red-800 dark:bg-red-500/20 dark:text-red-300',
  not_found: 'bg-muted text-muted-foreground',
  loading_card: 'bg-muted text-muted-foreground',
  serp_only:
    'bg-sky-100 text-sky-900 dark:bg-sky-500/20 dark:text-sky-200',
  oos: 'bg-orange-100 text-orange-900 dark:bg-orange-500/20 dark:text-orange-200',
  blocked: 'bg-muted text-muted-foreground',
  unverified_manual:
    'bg-amber-100 text-amber-900 dark:bg-amber-500/20 dark:text-amber-200',
};

function MatchStatusBadge({
  status,
  alternativeCount = 0,
}: {
  status: MatchStatus;
  alternativeCount?: number;
}) {
  if (status === 'not_found') return null;

  const hint = matchStatusShortHint(status, alternativeCount);

  // «Проверено» — компактная иконка, чтобы не конкурировать с «Где дешевле»
  if (status === 'verified') {
    return (
      <span
        className={`inline-flex h-5 w-5 items-center justify-center rounded-full ${STATUS_STYLES.verified}`}
        title={hint}
        aria-label={hint}
      >
        <Check className="h-3 w-3" strokeWidth={2.5} aria-hidden />
      </span>
    );
  }

  return (
    <span
      className={`inline-flex w-fit max-w-full items-center gap-1 rounded-full px-1.5 py-0.5 text-[9px] font-semibold ${STATUS_STYLES[status]}`}
      title={hint}
    >
      <span aria-hidden>{status === 'probable' ? '🟡' : '🔴'}</span>
      <span className="truncate">{hint}</span>
    </span>
  );
}

/** Короткие тексты ошибок для UI (полный query — только в title). */
function formatOfferErrorForDisplay(error: string): {
  text: string;
  title?: string;
  vpnHint?: boolean;
} {
  const trimmed = error.trim();

  if (/ограничивает автоматический поиск|подтвердите.*не робот|captcha|antibot/i.test(trimmed)) {
    return {
      text: /ozon/i.test(trimmed)
        ? 'Ozon временно ограничивает автоматический поиск. Укажите ссылку на карточку вручную.'
        : 'Площадка временно ограничивает автоматический поиск. Укажите ссылку вручную.',
      title: trimmed,
      vpnHint: true,
    };
  }

  if (/лимит запросов|слишком много запросов|429|rate.?limit|временно недоступ/i.test(trimmed)) {
    const mp =
      /wildberries|wb/i.test(trimmed)
        ? 'Wildberries'
        : /ozon/i.test(trimmed)
          ? 'Ozon'
          : /яндекс|я\.?маркет|yandex/i.test(trimmed)
            ? 'Яндекс.Маркет'
            : null;
    const text = mp
      ? `${mp} временно недоступен из‑за лимита запросов. Попробуйте позже или укажите ссылку вручную.`
      : 'Площадка временно недоступна из‑за лимита запросов. Попробуйте позже или укажите ссылку вручную.';
    return { text, title: trimmed, vpnHint: true };
  }

  const queryMatch = trimmed.match(/\(запрос:\s*«([^»]+)»\)/i);
  if (queryMatch || /не найден подходящий|не найден в выдаче|в выдаче не найден/i.test(trimmed)) {
    return {
      text: 'Подходящий товар в выдаче не найден. Укажите ссылку вручную.',
      title: queryMatch ? `Запрос: ${queryMatch[1]}` : trimmed,
      vpnHint: errorSuggestsVpnHint(trimmed),
    };
  }

  return { text: trimmed, vpnHint: errorSuggestsVpnHint(trimmed) };
}

function OfferStatusBadge({
  offer,
  isSearching,
  isSource,
  isManual,
}: {
  offer: MarketplaceOffer;
  isSearching: boolean;
  isSource?: boolean;
  isManual?: boolean;
}) {
  if (isSearching) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-blue-500/15 px-2 py-0.5 text-[9px] font-semibold text-blue-700 dark:text-blue-300">
        <Search className="h-3 w-3 animate-pulse" />
        Поиск…
      </span>
    );
  }

  const status = offerMatchStatus(offer, { isSource, isManual });
  const alts = offer.searchCandidates?.length ?? 0;

  if (status === 'verified' || status === 'probable' || status === 'needs_choice') {
    return <MatchStatusBadge status={status} alternativeCount={alts} />;
  }

  // leftover loading_card after job ended — never keep eternal «Поиск…»
  if (status === 'loading_card') {
    return (
      <span className="inline-flex w-fit rounded-full bg-muted px-2 py-0.5 text-[9px] font-medium text-muted-foreground">
        Не найдено
      </span>
    );
  }

  if (offer.error && !isOfferWithPrice(offer)) {
    const outOfStock =
      offer.error === 'Нет в наличии' || /нет в наличии|распродан/i.test(offer.error);
    return (
      <span className="inline-flex w-fit rounded-full bg-amber-500/15 px-2 py-0.5 text-[9px] font-semibold text-amber-800 dark:text-amber-300">
        {outOfStock ? 'Нет в наличии' : 'Не найдено'}
      </span>
    );
  }

  if (status === 'not_found' || status === 'oos' || status === 'blocked' || !isOfferWithPrice(offer)) {
    return (
      <span className="inline-flex w-fit rounded-full bg-muted px-2 py-0.5 text-[9px] font-medium text-muted-foreground">
        {status === 'oos' ? 'Нет в наличии' : 'Не найдено'}
      </span>
    );
  }

  return null;
}

function isProductPageOffer(offer: MarketplaceOffer): boolean {
  return Boolean(offer.url && isProductPageUrl(offer.url));
}

function RatingCell({ offer }: { offer: MarketplaceOffer }) {
  // До выбора варианта / без цены рейтинг строки не показываем
  if (offer.needsManualPick || !isOfferWithPrice(offer)) {
    return <span className="text-muted-foreground">—</span>;
  }

  const rating = normalizeMarketplaceRating(offer.rating);

  if (rating != null) {
    return (
      <span className="inline-flex items-center gap-0.5 font-medium">
        <Star className="h-3 w-3 fill-amber-400 text-amber-400" />
        {rating.toFixed(1)}
        {offer.reviewCount != null && offer.reviewCount > 0 && (
          <span className="text-[10px] text-muted-foreground">({offer.reviewCount})</span>
        )}
      </span>
    );
  }

  return (
    <span
      className="text-[11px] text-muted-foreground"
      title="Рейтинг подтянется с карточки"
    >
      …
    </span>
  );
}

/**
 * Пул кандидатов:
 * - needs_choice → раскрыт сразу
 * - probable → свёрнут «Ещё N вариантов»
 */
function CandidatePicker({
  marketplace,
  candidates,
  onSelect,
  onRejectCandidate,
  isSelecting,
  isRejecting,
  forceOpen,
  rejectedUrls,
}: {
  marketplace: ComparisonMarketplace;
  candidates: SearchCandidateOffer[];
  onSelect: (
    url: string,
    hint?: { title?: string; price?: number | null; rating?: number | null },
  ) => Promise<void>;
  onRejectCandidate?: (url: string) => Promise<void>;
  isSelecting: boolean;
  isRejecting?: boolean;
  forceOpen?: boolean;
  rejectedUrls?: string[];
}) {
  const [open, setOpen] = useState(Boolean(forceOpen));

  if (!candidates.length) return null;

  const priced = candidates.filter((c) => c.price != null && c.price > 0);
  const cheapest =
    priced.length >= 2
      ? priced.reduce((a, b) => ((a.price ?? Infinity) <= (b.price ?? Infinity) ? a : b))
      : null;

  const header = forceOpen
    ? 'Выберите нужный вариант:'
    : `Ещё ${candidates.length} вариант${candidates.length === 1 ? '' : candidates.length < 5 ? 'а' : 'ов'}`;

  const isRejectedUrl = (url: string) =>
    Boolean(rejectedUrls?.length) &&
    rejectedUrls!.some((e) => {
      try {
        const a = url.split('?')[0].split('#')[0];
        const b = e.split('?')[0].split('#')[0];
        return a === b || a.includes(b) || b.includes(a);
      } catch {
        return url === e;
      }
    });

  return (
    <div
      className={`mt-1.5 space-y-1 rounded-md border p-2 ${
        forceOpen
          ? 'border-amber-300/50 bg-amber-50/80 dark:border-amber-500/30 dark:bg-amber-500/10'
          : 'border-border/60 bg-muted/30'
      }`}
      role="region"
      aria-label="Альтернативные варианты"
    >
      <button
        type="button"
        className="flex w-full items-center justify-between gap-2 text-left text-[10px] font-semibold text-foreground"
        onClick={() => setOpen((v) => !v)}
      >
        <span>{header}</span>
        <ChevronDown className={`h-3.5 w-3.5 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <>
          {forceOpen && cheapest && !isRejectedUrl(cheapest.url) && (
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={isSelecting || isRejecting}
              className="h-auto min-h-7 w-full min-w-0 whitespace-normal px-2 py-1 text-[10px] leading-snug"
              onClick={() =>
                void onSelect(cheapest.url, {
                  title: cheapest.title,
                  price: cheapest.price,
                  rating: cheapest.rating,
                })
              }
            >
              Самый дешёвый · {formatPrice(cheapest.price!)}
            </Button>
          )}
          <ul className="space-y-1">
            {candidates.map((candidate, index) => {
              const candidateRating = normalizeMarketplaceRating(candidate.rating);
              const alreadyRejected = isRejectedUrl(candidate.url);
              return (
              <li key={candidate.url}>
                <div
                  className={`flex w-full items-start gap-1.5 rounded border border-transparent p-1.5 transition-colors ${
                    alreadyRejected
                      ? 'bg-muted/40 opacity-60'
                      : 'bg-background/80 hover:border-primary/40 hover:bg-primary/5'
                  }`}
                >
                  <button
                    type="button"
                    disabled={isSelecting || isRejecting || alreadyRejected}
                    onClick={() =>
                      void onSelect(candidate.url, {
                        title: candidate.title,
                        price: candidate.price,
                        rating: candidate.rating,
                      })
                    }
                    className="flex min-w-0 flex-1 items-start gap-2 text-left disabled:opacity-50"
                  >
                    {candidate.imageUrl || candidate.imageUrlAlternatives?.length ? (
                      <ProductImage
                        product={{
                          title: candidate.title,
                          imageUrl: candidate.imageUrl,
                          imageUrlAlternatives: candidate.imageUrlAlternatives,
                        }}
                        className="mt-0.5 h-9 w-9 rounded"
                        compact
                      />
                    ) : (
                      <Check className="mt-0.5 h-3 w-3 shrink-0 text-primary" />
                    )}
                    <div className="min-w-0 flex-1">
                      <p
                        className={`line-clamp-2 text-[11px] font-medium leading-snug ${
                          alreadyRejected ? 'text-muted-foreground line-through' : ''
                        }`}
                        title={candidate.title}
                      >
                        {index === 0 && forceOpen && !alreadyRejected ? 'Рекомендуем: ' : ''}
                        {sanitizeCandidateTitle(candidate.title, undefined, candidate.url)}
                      </p>
                      {alreadyRejected ? (
                        <p className="mt-0.5 text-[10px] text-muted-foreground">отклонено вами</p>
                      ) : (
                        <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                          {candidate.price != null && candidate.price > 0 && (
                            <span className="text-[11px] font-bold">{formatPrice(candidate.price)}</span>
                          )}
                          {candidateRating != null && (
                            <span className="inline-flex items-center gap-0.5 text-[10px] text-muted-foreground">
                              <Star className="h-2.5 w-2.5 fill-amber-400 text-amber-400" />
                              {candidateRating.toFixed(1)}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                    {isSelecting ? (
                      <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-primary" />
                    ) : null}
                  </button>
                  {onRejectCandidate && !alreadyRejected ? (
                    <button
                      type="button"
                      title="Не тот товар"
                      aria-label="Это не тот товар"
                      disabled={isSelecting || isRejecting}
                      className="mt-0.5 shrink-0 rounded p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        void onRejectCandidate(candidate.url);
                      }}
                    >
                      {isRejecting ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <XCircle className="h-4 w-4" />
                      )}
                    </button>
                  ) : null}
                  <button
                    type="button"
                    title="Открыть на площадке"
                    aria-label="Открыть товар на площадке"
                    className="mt-0.5 shrink-0 rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      const safe = safeMarketplaceHref(candidate.url, marketplace);
                      if (safe) {
                        void chrome.tabs.create({ url: safe });
                        return;
                      }
                      // Relative / host mismatch — resolve then open
                      void import('@/utils/comparison-url').then(({ resolveCompareCandidateUrl }) => {
                        const abs = resolveCompareCandidateUrl(candidate.url, marketplace);
                        const retry = safeMarketplaceHref(abs, marketplace);
                        if (retry) void chrome.tabs.create({ url: retry });
                      });
                    }}
                  >
                    <ExternalLink className="h-4 w-4" />
                  </button>
                </div>
              </li>
              );
            })}
          </ul>
          <p className="text-[10px] text-muted-foreground">
            После выбора подгрузим данные с {marketplaceShortLabel[marketplace]}
          </p>
        </>
      )}
    </div>
  );
}

/** Сворачиваемая форма ручной ссылки — по умолчанию закрыта. */
function ManualLinkRow({
  marketplace,
  offer,
  onManualLink,
  isLinking,
}: {
  marketplace: ComparisonMarketplace;
  offer: MarketplaceOffer;
  onManualLink: (marketplace: ComparisonMarketplace, url: string) => Promise<void>;
  isLinking: boolean;
}) {
  const hasPrice = isOfferWithPrice(offer);
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);

  const handleSubmit = async () => {
    const trimmed = url.trim();
    if (!trimmed) return;

    setLocalError(null);
    try {
      await onManualLink(marketplace, trimmed);
      setUrl('');
      if (hasPrice) setOpen(false);
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Не удалось загрузить');
    }
  };

  if (!open) {
    if (hasPrice) {
      return (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setOpen(true)}
          className="mt-1 h-7 gap-1 px-2 text-[10px] font-medium text-foreground/70 hover:bg-muted hover:text-foreground"
        >
          <Link2 className="h-3 w-3" />
          Заменить ссылку
        </Button>
      );
    }
    return (
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
        className="mt-1.5 h-7 gap-1.5 border-primary/40 bg-primary/5 text-[10px] font-semibold text-primary hover:bg-primary/10"
      >
        <Link2 className="h-3 w-3" />
        Указать ссылку
      </Button>
    );
  }

  return (
    <div
      className="mt-1.5 space-y-1 rounded-md border border-dashed border-primary/30 bg-primary/5 p-2"
      role="region"
      aria-label="Ручная ссылка на карточку"
    >
      {hasPrice && offer.title && offer.title !== 'Товар' && (
        <p className="line-clamp-2 text-[11px] text-muted-foreground" title={offer.title}>
          Сейчас: {offer.title}
        </p>
      )}
      <div className="flex gap-1">
        <input
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder={marketplaceUrlPlaceholder[marketplace]}
          disabled={isLinking}
          className="min-w-0 flex-1 rounded border bg-background px-2 py-1 text-[11px] outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onKeyDown={(e) => {
            if (e.key === 'Enter') void handleSubmit();
          }}
        />
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-7 shrink-0 px-2 text-[9px]"
          disabled={!url.trim() || isLinking}
          onClick={() => void handleSubmit()}
          title="Загрузить карточку по ссылке"
        >
          {isLinking ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <Link2 className="h-3 w-3" />
          )}
        </Button>
      </div>
      {localError && <p className="text-[11px] text-red-600 dark:text-red-400">{localError}</p>}
      <p className="text-[11px] text-muted-foreground">
        Вставьте прямую ссылку на карточку товара (не страницу поиска)
      </p>
      <button
        type="button"
        onClick={() => {
          setOpen(false);
          setLocalError(null);
        }}
        className="text-[11px] text-muted-foreground hover:text-foreground"
      >
        Свернуть
      </button>
    </div>
  );
}

export function ComparisonTable({
  offers,
  productId,
  referenceTitle,
  referenceSpecs,
  sourceMarketplace,
  isLoading,
  searchingMarketplace,
  onManualLink,
  onRejectOffer,
  onRejectCandidate,
  onSelectCandidate,
  onResearchMarketplace,
  linkingMarketplace,
  rejectingMarketplace,
  selectingMarketplace,
  rejectedOfferUrls,
}: ComparisonTableProps) {
  const cheapest = findCheapestOffer(offers);
  const [dismissed, setDismissed] = useState<Record<string, boolean>>({});

  useEffect(() => {
    void chrome.storage.local.get(MATCH_WARN_DISMISS_KEY).then((stored) => {
      const raw = stored[MATCH_WARN_DISMISS_KEY];
      if (raw && typeof raw === 'object') setDismissed(raw as Record<string, boolean>);
    });
  }, []);

  const dismissWarn = useCallback(
    (marketplace: ComparisonMarketplace) => {
      const key = `${productId ?? 'x'}:${marketplace}`;
      setDismissed((prev) => {
        const next = { ...prev, [key]: true };
        void chrome.storage.local.set({ [MATCH_WARN_DISMISS_KEY]: next });
        return next;
      });
    },
    [productId],
  );

  return (
    <div className="relative min-w-0 overflow-hidden rounded-md bg-muted/50">
      {isLoading && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-background/70 backdrop-blur-[1px]">
          <Loader2 className="h-5 w-5 animate-spin text-primary" />
          <p className="text-center text-[11px] text-muted-foreground">
            {searchingMarketplace === SEARCHING_MP_CROSS
              ? 'Ищем на других площадках…'
              : searchingMarketplace
                ? `Ищем на ${marketplaceShortLabel[searchingMarketplace]}…`
                : 'Обновляем цены…'}
          </p>
        </div>
      )}
      <table className="w-full table-fixed text-left text-xs">
        <thead>
          <tr className="border-b border-border/60 text-[10px] font-medium uppercase tracking-wider text-foreground/55">
            <th className="w-[44%] px-2.5 py-2">Площадка</th>
            <th className="w-[22%] px-2 py-2">Цена</th>
            <th className="w-[18%] px-2 py-2">Рейтинг</th>
            <th className="w-[16%] px-1 py-2 text-center" title="Ссылка">
              Ссылка
            </th>
          </tr>
        </thead>
        <tbody>
          {offers.map((offer) => {
            const hasPrice = isOfferWithPrice(offer);
            const isSource = offer.marketplace === sourceMarketplace;
            const warnKey = `${productId ?? 'x'}:${offer.marketplace}`;
            const warnKind =
              Boolean(referenceTitle) &&
              hasPrice &&
              !isSource &&
              !dismissed[warnKey]
                ? getMatchWarnKind(
                    referenceTitle!,
                    offer.title || '',
                    offer.matchConfidence,
                    referenceSpecs,
                  )
                : null;
            const showMatchWarn = warnKind != null;
            const isCheapest =
              cheapest?.marketplace === offer.marketplace && hasPrice && !showMatchWarn;
            const isLinking = linkingMarketplace === offer.marketplace;
            const isRejecting = rejectingMarketplace === offer.marketplace;
            const isSelecting = selectingMarketplace === offer.marketplace;
            const showCandidates =
              Boolean(offer.searchCandidates?.length) && Boolean(onSelectCandidate);
            const needsChoice = Boolean(offer.needsManualPick);

            const isSearching = Boolean(
              isLoading &&
                (searchingMarketplace === offer.marketplace ||
                  searchingMarketplace === SEARCHING_MP_CROSS),
            );

            return (
              <tr
                key={offer.marketplace}
                className={`border-b last:border-0 ${
                  isCheapest
                    ? 'bg-success/10'
                    : 'hover:bg-muted/30'
                }`}
              >
                <td className="px-2.5 py-2.5 align-top">
                  <div className="flex flex-col gap-1.5">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Badge
                        variant={marketplaceBadgeVariant[offer.marketplace]}
                        className="w-fit text-[10px]"
                      >
                        {marketplaceShortLabel[offer.marketplace]}
                      </Badge>
                      <OfferStatusBadge
                        offer={offer}
                        isSearching={isSearching}
                        isSource={isSource}
                      />
                    </div>
                    {isCheapest && (
                      <Badge variant="success" className="w-fit gap-0.5 font-semibold">
                        <Trophy className="h-3 w-3" aria-hidden />
                        Где дешевле
                      </Badge>
                    )}
                    {showMatchWarn && (
                      <div className="flex items-start gap-1 rounded-sm bg-amber-500/10 px-1.5 py-1 text-[10px] leading-snug text-amber-900 dark:text-amber-100">
                        <p className="min-w-0 flex-1">
                          {warnKind === 'category'
                            ? 'Похоже, другая категория. Проверьте карточку или нажмите «Это не тот товар».'
                            : 'Низкая уверенность совпадения — названия слабо похожи. Проверьте карточку или нажмите «Это не тот товар».'}
                        </p>
                        <button
                          type="button"
                          className="shrink-0 rounded p-0.5 hover:bg-amber-500/20"
                          aria-label="Скрыть предупреждение"
                          onClick={() => dismissWarn(offer.marketplace)}
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                    )}
                    {hasPrice && offer.title && offer.title !== 'Товар' && (
                      <p className="line-clamp-2 text-[11px] text-foreground/90" title={offer.title}>
                        {offer.title}
                      </p>
                    )}
                    {offer.specs && (
                      <p className="line-clamp-2 text-[11px] text-muted-foreground" title={offer.specs}>
                        {offer.specs}
                      </p>
                    )}
                    {((offer.error && !hasPrice) ||
                      ((offer.matchStatus === 'not_found' ||
                        offer.matchStatus === 'blocked' ||
                        offer.matchStatus === 'oos' ||
                        (offer.matchStatus === 'loading_card' && !isLoading)) &&
                        !hasPrice &&
                        !needsChoice)) && (() => {
                      const formatted = formatOfferErrorForDisplay(
                        offer.error ?? 'Товар не найден — добавьте прямую ссылку на карточку',
                      );
                      return (
                        <div className="space-y-1">
                          <p
                            className="text-[11px] leading-snug text-amber-800 dark:text-amber-200"
                            title={formatted.title}
                          >
                            {formatted.text}
                          </p>
                          {formatted.vpnHint ? (
                            <p className="text-[10px] leading-snug text-foreground/55">
                              {VPN_SEARCH_HINT}
                            </p>
                          ) : null}
                          {onResearchMarketplace && !isSearching ? (
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              disabled={isLoading}
                              onClick={() => onResearchMarketplace(offer.marketplace)}
                              className="mt-0.5 h-7 gap-1 px-2 text-[10px] font-medium"
                              title={`Найти товар только на ${marketplaceShortLabel[offer.marketplace]}`}
                            >
                              <Search className="h-3 w-3" />
                              Найти на {marketplaceShortLabel[offer.marketplace]}
                            </Button>
                          ) : null}
                        </div>
                      );
                    })()}
                    {showCandidates && onSelectCandidate && (
                      <CandidatePicker
                        marketplace={offer.marketplace}
                        candidates={offer.searchCandidates!}
                        isSelecting={isSelecting}
                        isRejecting={isRejecting}
                        forceOpen={needsChoice}
                        rejectedUrls={rejectedOfferUrls?.[offer.marketplace]}
                        onSelect={(url, hint) =>
                          onSelectCandidate(offer.marketplace, url, hint)
                        }
                        onRejectCandidate={
                          onRejectCandidate
                            ? (url) => onRejectCandidate(offer.marketplace, url)
                            : undefined
                        }
                      />
                    )}
                    {onRejectOffer &&
                      hasPrice &&
                      offer.url &&
                      isProductPageOffer(offer) &&
                      offer.marketplace !== sourceMarketplace && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={isRejecting || isLoading}
                        onClick={() => void onRejectOffer(offer.marketplace, offer.url)}
                        className="mt-1 h-7 gap-1 px-2 text-[10px] font-medium text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                        title="Отклонить и взять следующего кандидата"
                      >
                        {isRejecting ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <XCircle className="h-3 w-3" />
                        )}
                        Это не тот товар
                      </Button>
                    )}
                    {onManualLink && (
                      <ManualLinkRow
                        marketplace={offer.marketplace}
                        offer={offer}
                        onManualLink={onManualLink}
                        isLinking={isLinking}
                      />
                    )}
                  </div>
                </td>
                <td className="px-2 py-2.5 align-top">
                  {hasPrice ? (
                    <div className="space-y-0.5">
                      <p className="truncate text-sm font-semibold text-foreground">
                        {formatPrice(offer.basePrice ?? offer.price!)}
                      </p>
                      {offer.basePrice != null &&
                        offer.payPrice != null &&
                        offer.payPrice < offer.basePrice && (
                          <p className="text-[10px] text-emerald-700 dark:text-emerald-400">
                            {paymentDiscountLabel(offer.marketplace)}{' '}
                            {formatPrice(offer.payPrice)}
                          </p>
                        )}
                      {offer.payPrice != null && offer.basePrice == null && (
                        <p className="text-[10px] text-emerald-700 dark:text-emerald-400">
                          цена {paymentDiscountLabel(offer.marketplace)}
                        </p>
                      )}
                      {offer.oldPrice && offer.oldPrice > (offer.basePrice ?? offer.price ?? 0) && (
                        <p className="text-[11px] text-muted-foreground line-through">
                          {formatPrice(offer.oldPrice)}
                        </p>
                      )}
                      {offer.marketplace === 'yandex_market' &&
                        offer.basePrice != null &&
                        offer.payPrice != null &&
                        offer.payPrice < offer.basePrice && (
                          <p className="text-[9px] text-muted-foreground">Цена по карте</p>
                        )}
                      {offer.marketplace === 'ozon' &&
                        offer.basePrice != null &&
                        offer.payPrice != null &&
                        offer.payPrice < offer.basePrice && (
                          <p className="text-[9px] text-muted-foreground">С другими банками</p>
                        )}
                    </div>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </td>
                <td className="px-2 py-2.5 align-top">
                  <RatingCell offer={offer} />
                </td>
                <td className="px-1 py-2.5 text-center align-top">
                  {isProductPageOffer(offer) ? (
                    <ProductLink
                      url={offer.url}
                      marketplace={offer.marketplace}
                      className="inline-flex h-7 w-7 items-center justify-center rounded-md text-primary hover:bg-primary/10"
                      title={`Открыть на ${COMPARISON_MARKETPLACE_LABELS[offer.marketplace]}`}
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                    </ProductLink>
                  ) : (
                    <span
                      className="inline-flex h-7 w-7 items-center justify-center text-muted-foreground"
                      title="Ссылка на карточку появится после выбора товара"
                    >
                      —
                    </span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
