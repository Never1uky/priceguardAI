/**
 * Detail panel for one CompareProduct — shared by MyProductsTab / legacy CompareTab.
 */
import { Button } from '@/components/ui/button';
import { Surface } from '@/components/ui/surface';
import { COMPARISON_MARKETPLACE_LABELS, type ComparisonMarketplace } from '@/types/comparison';
import { ComparisonTable } from '@/popup/components/ComparisonTable';
import { AuthenticityHint } from '@/popup/components/AuthenticityHint';
import type { useCompareTab } from '@/popup/hooks/useCompareTab';
import { Loader2, RefreshCw, Search } from 'lucide-react';

type CompareTabApi = ReturnType<typeof useCompareTab>;

interface CompareProductDetailProps {
  api: CompareTabApi;
}

export function CompareProductDetail({ api }: CompareProductDetailProps) {
  const {
    selectedProduct,
    offers,
    isRefreshing,
    error,
    linkingMarketplace,
    rejectingMarketplace,
    searchingMarketplace,
    selectingMarketplace,
    foundMarketplacesCount,
    searchMarketplacesCount,
    hasCache,
    comparedAtLabel,
    refreshCompare,
    researchCompare,
    researchMarketplace,
    handleManualLink,
    handleRejectOffer,
    handleRejectCandidate,
    handleSelectCandidate,
  } = api;

  if (!selectedProduct) return null;

  const totalSlots = Math.max(searchMarketplacesCount || offers.length, 1);

  return (
    <div className="space-y-3">
      <AuthenticityHint
        marketplace={selectedProduct.sourceMarketplace}
        authenticity={selectedProduct.authenticity}
      />
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate pg-subtitle">{selectedProduct.title}</p>
          <p className="pg-caption mt-1 text-muted-foreground">
            Найдено на {foundMarketplacesCount} из {totalSlots} площадок
            {comparedAtLabel ? ` · данные от ${comparedAtLabel}` : ''}
            {' · '}
            {COMPARISON_MARKETPLACE_LABELS[selectedProduct.sourceMarketplace]}
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
        productId={selectedProduct.id}
        referenceTitle={selectedProduct.title}
        referenceSpecs={selectedProduct.sourceOffer?.specs}
        sourceMarketplace={selectedProduct.sourceMarketplace}
        isLoading={isRefreshing}
        searchingMarketplace={searchingMarketplace}
        onManualLink={handleManualLink}
        onRejectOffer={handleRejectOffer}
        onRejectCandidate={handleRejectCandidate}
        onSelectCandidate={handleSelectCandidate}
        onResearchMarketplace={(mp) => void researchMarketplace(selectedProduct, mp)}
        linkingMarketplace={linkingMarketplace}
        rejectingMarketplace={rejectingMarketplace}
        selectingMarketplace={selectingMarketplace}
        rejectedOfferUrls={selectedProduct.rejectedOfferUrls}
      />

      {hasCache && !isRefreshing && (
        <p className="pg-hint text-center leading-relaxed">
          «Обновить данные» — цены по карточкам. «Найти заново» — новый поиск. «Это не тот
          товар» — следующий кандидат.
        </p>
      )}
    </div>
  );
}

export type { ComparisonMarketplace };
