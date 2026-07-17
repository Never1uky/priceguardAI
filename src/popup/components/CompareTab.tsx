import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { SectionLabel } from '@/components/ui/section-label';
import { Surface } from '@/components/ui/surface';
import { COMPARISON_MARKETPLACE_LABELS, type ComparisonMarketplace } from '@/types/comparison';
import { ComparisonTable } from '@/popup/components/ComparisonTable';
import { useCompareTab } from '@/popup/hooks/useCompareTab';
import { FREE_LIMITS } from '@/types/subscription';
import { AuthenticityHint } from '@/popup/components/AuthenticityHint';
import { isPremium } from '@/lib/subscription';
import { Loader2, PackageSearch, RefreshCw, Scale, Search, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';

interface CompareTabProps {
  isActive: boolean;
}

const marketplaceBadge: Record<ComparisonMarketplace, 'wildberries' | 'ozon' | 'yandex'> = {
  wildberries: 'wildberries',
  ozon: 'ozon',
  yandex_market: 'yandex',
};

export function CompareTab({ isActive }: CompareTabProps) {
  const {
    products,
    selectedProduct,
    offers,
    isRefreshing,
    error,
    linkingMarketplace,
    rejectingMarketplace,
    searchingMarketplace,
    selectingMarketplace,
    foundMarketplacesCount,
    hasCache,
    comparedAtLabel,
    refreshCompare,
    researchCompare,
    refreshAllComparePrices,
    handleSelect,
    handleRemove,
    handleManualLink,
    handleRejectOffer,
    handleSelectCandidate,
  } = useCompareTab(isActive);

  const [premium, setPremium] = useState(false);
  useEffect(() => {
    void isPremium().then(setPremium);
  }, []);

  const compareLimit = premium ? null : FREE_LIMITS.maxCompareProducts;

  const linkedMarketplaces = (product: typeof selectedProduct) =>
    product
      ? (['wildberries', 'ozon', 'yandex_market'] as const).filter((mp) =>
          Boolean(product.marketplaceUrls[mp] || product.sourceMarketplace === mp),
        )
      : [];

  return (
    <div className="space-y-3">
      {compareLimit != null && (
        <p className="pg-hint text-center">
          Сравнение: {products.length} из {compareLimit} товаров
          {products.length >= compareLimit && ' · Premium — без лимита'}
        </p>
      )}
      {products.length > 0 ? (
        <Surface variant="subtle" padding="sm" className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <SectionLabel>Товары для сравнения</SectionLabel>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 gap-1 px-2 text-[10px]"
              onClick={() => void refreshAllComparePrices()}
              disabled={isRefreshing || products.length === 0}
              title="Обновить цены по всем товарам сравнения"
            >
              {isRefreshing ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" strokeWidth={1.75} />
              )}
              Обновить все цены
            </Button>
          </div>
          <div className="space-y-1.5">
            {products.map((product) => (
              <button
                key={product.id}
                type="button"
                onClick={() => void handleSelect(product.id)}
                className={`flex w-full min-w-0 items-start gap-2 rounded-sm p-2.5 text-left pg-transition ${
                  selectedProduct?.id === product.id
                    ? 'bg-background shadow-soft ring-1 ring-primary/20'
                    : 'hover:bg-background/60'
                }`}
              >
                <Scale className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <p className="line-clamp-2 pg-body font-medium leading-snug">{product.title}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-1">
                    {linkedMarketplaces(product).map((mp) => (
                      <Badge key={mp} variant={marketplaceBadge[mp]} className="px-1.5 py-0 text-[9px]">
                        {COMPARISON_MARKETPLACE_LABELS[mp].split(' ')[0]}
                      </Badge>
                    ))}
                    {product.article && (
                      <span className="pg-caption text-muted-foreground">· арт. {product.article}</span>
                    )}
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 shrink-0 text-destructive hover:bg-destructive/10"
                  onClick={(e) => {
                    e.stopPropagation();
                    void handleRemove(product.id);
                  }}
                  title="Удалить"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </button>
            ))}
          </div>
        </Surface>
      ) : (
        <EmptyState
          icon={PackageSearch}
          title="Нет товаров для сравнения"
          description="Нажмите «Сравнить» на вкладке «Цены и сравнение» — увидите, где дешевле на WB, Ozon и Маркете."
        />
      )}

      {selectedProduct && (
        <>
          <AuthenticityHint
            marketplace={selectedProduct.sourceMarketplace}
            authenticity={selectedProduct.authenticity}
          />
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate pg-subtitle">{selectedProduct.title}</p>
              <p className="pg-caption mt-1 text-muted-foreground">
                Найдено на {foundMarketplacesCount} из 3 площадок
                {comparedAtLabel ? ` · данные от ${comparedAtLabel}` : ''}
              </p>
            </div>
            <div className="flex shrink-0 flex-col gap-1.5 sm:flex-row">
              <Button
                size="sm"
                variant="outline"
                className="shrink-0 gap-1"
                onClick={() => void refreshCompare(selectedProduct, true)}
                disabled={isRefreshing}
                title="Обновить цены по уже привязанным карточкам"
              >
                {isRefreshing ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="h-3.5 w-3.5" />
                )}
                Обновить данные
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="shrink-0 gap-1"
                onClick={() => void researchCompare(selectedProduct)}
                disabled={isRefreshing}
                title="Сбросить привязки и найти товары заново"
              >
                <Search className="h-3.5 w-3.5" />
                Найти заново
              </Button>
            </div>
          </div>

          {error && (
            <Surface variant="subtle" padding="sm" className="pg-body bg-destructive/10 text-destructive">
              {error}
            </Surface>
          )}

          <ComparisonTable
            offers={offers}
            sourceMarketplace={selectedProduct?.sourceMarketplace}
            isLoading={isRefreshing}
            searchingMarketplace={searchingMarketplace}
            onManualLink={handleManualLink}
            onRejectOffer={handleRejectOffer}
            onSelectCandidate={handleSelectCandidate}
            linkingMarketplace={linkingMarketplace}
            rejectingMarketplace={rejectingMarketplace}
            selectingMarketplace={selectingMarketplace}
          />

          {hasCache && !isRefreshing && (
            <p className="pg-hint text-center leading-relaxed">
              «Обновить данные» — цены по карточкам. «Найти заново» — новый поиск. «Это не тот
              товар» — следующий кандидат.
            </p>
          )}
        </>
      )}
    </div>
  );
}
