import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { formatPrice, paymentDiscountLabel } from '@/lib/utils';
import { isOfferWithPrice } from '@/lib/compare-offers';
import { findCheapestOffer } from '@/lib/marketplace-search';
import { isProductPageUrl } from '@/lib/product-match';
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
import { ExternalLink, Link2, Loader2, Star, Trophy, XCircle, Check, Search, ChevronDown } from 'lucide-react';
import { useState } from 'react';

interface ComparisonTableProps {
  offers: MarketplaceOffer[];
  sourceMarketplace?: ComparisonMarketplace;
  isLoading?: boolean;
  searchingMarketplace?: ComparisonMarketplace | typeof SEARCHING_MP_CROSS | null;
  onManualLink?: (marketplace: ComparisonMarketplace, url: string) => Promise<void>;
  onRejectOffer?: (marketplace: ComparisonMarketplace, rejectedUrl: string) => Promise<void>;
  onSelectCandidate?: (marketplace: ComparisonMarketplace, url: string) => Promise<void>;
  linkingMarketplace?: ComparisonMarketplace | null;
  rejectingMarketplace?: ComparisonMarketplace | null;
  selectingMarketplace?: ComparisonMarketplace | null;
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

const STATUS_STYLES: Record<MatchStatus, string> = {
  verified:
    'bg-green-100 text-green-800 dark:bg-green-500/20 dark:text-green-300',
  probable:
    'bg-amber-100 text-amber-900 dark:bg-amber-500/20 dark:text-amber-200',
  needs_choice:
    'bg-red-100 text-red-800 dark:bg-red-500/20 dark:text-red-300',
  not_found: 'bg-muted text-muted-foreground',
};

function MatchStatusBadge({
  status,
  alternativeCount = 0,
}: {
  status: MatchStatus;
  alternativeCount?: number;
}) {
  if (status === 'not_found') return null;

  return (
    <span
      className={`inline-flex w-fit max-w-full items-center gap-1 rounded-full px-1.5 py-0.5 text-[9px] font-semibold ${STATUS_STYLES[status]}`}
      title={matchStatusShortHint(status, alternativeCount)}
    >
      <span aria-hidden>
        {status === 'verified' ? '🟢' : status === 'probable' ? '🟡' : '🔴'}
      </span>
      <span className="truncate">{matchStatusShortHint(status, alternativeCount)}</span>
    </span>
  );
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

  if (offer.error && !isOfferWithPrice(offer)) {
    return (
      <span className="inline-flex w-fit rounded-full bg-amber-500/15 px-2 py-0.5 text-[9px] font-semibold text-amber-800 dark:text-amber-300">
        Не найдено
      </span>
    );
  }

  if (!isOfferWithPrice(offer)) {
    return (
      <span className="inline-flex w-fit rounded-full bg-muted px-2 py-0.5 text-[9px] font-medium text-muted-foreground">
        Нет цены
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

  const rating =
    offer.rating != null && offer.rating >= 1 && offer.rating <= 5 ? offer.rating : null;

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

  return <span className="text-[11px] text-muted-foreground">нет данных</span>;
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
  isSelecting,
  forceOpen,
}: {
  marketplace: ComparisonMarketplace;
  candidates: SearchCandidateOffer[];
  onSelect: (url: string) => Promise<void>;
  isSelecting: boolean;
  forceOpen?: boolean;
}) {
  const [open, setOpen] = useState(Boolean(forceOpen));

  if (!candidates.length) return null;

  const header = forceOpen
    ? 'Выберите нужный вариант:'
    : `Ещё ${candidates.length} вариант${candidates.length === 1 ? '' : candidates.length < 5 ? 'а' : 'ов'}`;

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
          <ul className="space-y-1">
            {candidates.map((candidate, index) => {
              const candidateRating =
                candidate.rating != null && candidate.rating >= 1 && candidate.rating <= 5
                  ? candidate.rating
                  : null;
              return (
              <li key={candidate.url}>
                <div className="flex w-full items-start gap-1.5 rounded border border-transparent bg-background/80 p-1.5 transition-colors hover:border-primary/40 hover:bg-primary/5">
                  <button
                    type="button"
                    disabled={isSelecting}
                    onClick={() => void onSelect(candidate.url)}
                    className="flex min-w-0 flex-1 items-start gap-2 text-left disabled:opacity-50"
                  >
                    <Check className="mt-0.5 h-3 w-3 shrink-0 text-primary" />
                    <div className="min-w-0 flex-1">
                      <p className="line-clamp-2 text-[11px] font-medium leading-snug" title={candidate.title}>
                        {index === 0 && forceOpen ? 'Рекомендуем: ' : ''}
                        {candidate.title}
                      </p>
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
                    </div>
                    {isSelecting ? (
                      <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-primary" />
                    ) : null}
                  </button>
                  <button
                    type="button"
                    title="Открыть на площадке"
                    aria-label="Открыть товар на площадке"
                    className="mt-0.5 shrink-0 rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      void chrome.tabs.create({ url: candidate.url });
                    }}
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
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
          className="min-w-0 flex-1 rounded border bg-background px-2 py-1 text-[11px] outline-none focus:ring-1 focus:ring-primary"
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
  sourceMarketplace,
  isLoading,
  searchingMarketplace,
  onManualLink,
  onRejectOffer,
  onSelectCandidate,
  linkingMarketplace,
  rejectingMarketplace,
  selectingMarketplace,
}: ComparisonTableProps) {
  const cheapest = findCheapestOffer(offers);

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
          <tr className="border-b border-border/60 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            <th className="w-[48%] px-2.5 py-2">Площадка</th>
            <th className="w-[23%] px-2 py-2">Цена</th>
            <th className="w-[19%] px-2 py-2">Рейтинг</th>
            <th className="w-[10%] px-1 py-2 text-center">Ссылка</th>
          </tr>
        </thead>
        <tbody>
          {offers.map((offer) => {
            const hasPrice = isOfferWithPrice(offer);
            const isCheapest = cheapest?.marketplace === offer.marketplace && hasPrice;
            const isLinking = linkingMarketplace === offer.marketplace;
            const isRejecting = rejectingMarketplace === offer.marketplace;
            const isSelecting = selectingMarketplace === offer.marketplace;
            const showCandidates =
              Boolean(offer.searchCandidates?.length) && Boolean(onSelectCandidate);
            const needsChoice = Boolean(offer.needsManualPick);
            const isSource = offer.marketplace === sourceMarketplace;

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
                      <span className="flex items-center gap-0.5 text-[10px] font-semibold text-green-700 dark:text-green-400">
                        <Trophy className="h-3 w-3" />
                        Лучшая цена
                      </span>
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
                    {offer.error && !hasPrice && (
                      <p className="text-[11px] text-amber-700 dark:text-amber-300">{offer.error}</p>
                    )}
                    {showCandidates && onSelectCandidate && (
                      <CandidatePicker
                        marketplace={offer.marketplace}
                        candidates={offer.searchCandidates!}
                        isSelecting={isSelecting}
                        forceOpen={needsChoice}
                        onSelect={(url) => onSelectCandidate(offer.marketplace, url)}
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
                  <ProductLink
                    url={offer.url}
                    marketplace={offer.marketplace}
                    className="inline-flex h-7 w-7 items-center justify-center rounded-md text-primary hover:bg-primary/10"
                    title={`Открыть на ${COMPARISON_MARKETPLACE_LABELS[offer.marketplace]}`}
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                  </ProductLink>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
