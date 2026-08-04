import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { sendRuntimeMessage } from '@/lib/runtime-message';
import { seedProductImageSync } from '@/lib/product-image';
import { FullAnalysisSection } from '@/popup/components/FullAnalysisSection';
import { ReviewPreviewQuotes } from '@/popup/components/ReviewPreviewQuotes';
import { ReviewProductPicker } from '@/popup/components/ReviewProductPicker';
import { ReviewUrlInput } from '@/popup/components/ReviewUrlInput';
import type { ReviewPreviewItem } from '@/lib/reviews/collect-reviews';
import { MIN_REVIEWS_FOR_ANALYSIS } from '@/types/review-analysis';
import { ProductImage } from '@/popup/components/ProductImage';
import { ProductLink } from '@/popup/components/ProductLink';
import type { ProductDataSource } from '@/popup/hooks/useLiveProduct';
import type { Product } from '@/types/product';
import { ExternalLink, Loader2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

interface ReviewsTabProps {
  product: Product | null;
  productDataSource?: ProductDataSource;
  isPremium?: boolean;
  suppressReviewFetch?: boolean;
  onOpenPremium?: () => void;
  onOpenAuth?: () => void;
  onOpenSettings?: () => void;
  onFullAnalysisBusyChange?: (busy: boolean) => void;
}

function productStableKey(p: Product): string {
  return `${p.marketplace}|${p.id}|${p.article ?? ''}`;
}

export function ReviewsTab({
  product,
  productDataSource = 'none',
  isPremium = false,
  suppressReviewFetch = false,
  onOpenPremium,
  onOpenAuth,
  onOpenSettings,
  onFullAnalysisBusyChange,
}: ReviewsTabProps) {
  const [pickedProduct, setPickedProduct] = useState<Product | null>(null);
  const [previewItems, setPreviewItems] = useState<ReviewPreviewItem[]>([]);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewSettled, setPreviewSettled] = useState(false);
  const [previewTotal, setPreviewTotal] = useState(0);
  const [reviewRatings, setReviewRatings] = useState<Array<number | undefined>>([]);
  const [insufficientReviews, setInsufficientReviews] = useState(false);

  const previewGenRef = useRef(0);
  const previewFetchedKeyRef = useRef<string | null>(null);
  const previewInFlightRef = useRef(false);

  const activeProduct = useMemo(() => {
    const raw = pickedProduct ?? product;
    return raw ? seedProductImageSync(raw) : null;
  }, [pickedProduct, product]);

  useEffect(() => {
    if (!activeProduct?.url || suppressReviewFetch) {
      setPreviewItems([]);
      setReviewRatings([]);
      setInsufficientReviews(false);
      setPreviewLoading(false);
      setPreviewSettled(false);
      return;
    }

    const sessionKey = productStableKey(activeProduct);
    if (previewFetchedKeyRef.current === sessionKey || previewInFlightRef.current) {
      return;
    }

    const generation = ++previewGenRef.current;
    previewInFlightRef.current = true;
    setPreviewLoading(true);
    setPreviewSettled(false);

    void (async () => {
      try {
        const { getRunningCompareProductId } = await import('@/lib/compare-jobs');
        if (await getRunningCompareProductId()) return;

        const res = await sendRuntimeMessage<{
          ok?: boolean;
          previewItems?: ReviewPreviewItem[];
          totalFound?: number;
          reviewCount?: number;
          reviewRatings?: Array<number | undefined>;
          insufficient?: boolean;
        }>({
          type: 'PREVIEW_REVIEWS',
          payload: {
            productUrl: activeProduct.url,
            marketplace: activeProduct.marketplace,
            article: activeProduct.article,
            filter: 'all',
          },
        });

        if (generation !== previewGenRef.current) return;
        if (res?.ok) {
          setPreviewItems(res.previewItems ?? []);
          setPreviewTotal(res.totalFound ?? res.reviewCount ?? 0);
          setReviewRatings(res.reviewRatings ?? []);
          setInsufficientReviews(Boolean(res.insufficient));
          previewFetchedKeyRef.current = sessionKey;
        }
      } finally {
        if (generation === previewGenRef.current) {
          previewInFlightRef.current = false;
          setPreviewLoading(false);
          setPreviewSettled(true);
        }
      }
    })();
  }, [activeProduct?.id, activeProduct?.marketplace, activeProduct?.article, suppressReviewFetch]);

  const handlePick = (next: Product) => {
    setPickedProduct(next);
    previewFetchedKeyRef.current = null;
  };

  const showProductLoading =
    !suppressReviewFetch && !activeProduct && productDataSource === 'loading';

  return (
    <div className="space-y-4">
      {showProductLoading ? (
        <div className="flex items-center justify-center gap-2 rounded-md bg-muted/40 py-6">
          <Loader2 className="h-4 w-4 animate-spin text-primary" />
          <p className="pg-subtitle text-muted-foreground">Загрузка данных товара…</p>
        </div>
      ) : activeProduct ? (
        <Card>
          <CardContent className="flex items-center gap-3 p-3">
            <ProductImage product={activeProduct} className="h-12 w-12 rounded-sm" />
            <div className="min-w-0 flex-1">
              <ProductLink
                url={activeProduct.url}
                marketplace={activeProduct.marketplace}
                className="line-clamp-1 pg-subtitle text-foreground underline-offset-2 hover:text-primary hover:underline"
              >
                {activeProduct.title}
              </ProductLink>
              <p className="pg-caption mt-1">
                {pickedProduct ? 'Выбран вручную' : 'AI-анализ'}
                {activeProduct.article ? ` · арт. ${activeProduct.article}` : ''}
              </p>
            </div>
            <Button variant="ghost" size="icon-sm" className="shrink-0" asChild>
              <ProductLink
                url={activeProduct.url}
                marketplace={activeProduct.marketplace}
                className="inline-flex h-8 w-8 items-center justify-center"
              >
                <ExternalLink className="h-4 w-4" strokeWidth={1.75} />
              </ProductLink>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <p className="pg-body text-center text-muted-foreground">
          Откройте карточку, вставьте ссылку или выберите товар ниже
        </p>
      )}

      <Card className="shadow-none ring-1 ring-dashed ring-border">
        <CardContent className="space-y-3 py-3">
          <ReviewUrlInput onLoaded={handlePick} />
          <div className="space-y-2 border-t border-border/60 pt-3">
            <p className="pg-hint font-medium text-foreground">Выбрать из списка / сравнения</p>
            <ReviewProductPicker
              selectedId={activeProduct?.id}
              selectedUrl={activeProduct?.url}
              onSelect={handlePick}
            />
          </div>
        </CardContent>
      </Card>

      {activeProduct && (
        <>
          <FullAnalysisSection
            product={activeProduct}
            isPremium={isPremium}
            reviewRatings={reviewRatings}
            onOpenPremium={() => onOpenPremium?.()}
            onOpenAuth={() => onOpenAuth?.()}
            onOpenSettings={() => onOpenSettings?.()}
            onBusyChange={onFullAnalysisBusyChange}
          />

          <ReviewPreviewQuotes
            items={previewItems}
            totalFound={previewTotal}
            isLoading={previewLoading || !previewSettled}
            showEmpty={previewSettled}
            productHints={[activeProduct.title]}
          />

          {insufficientReviews && (
            <div className="rounded-sm bg-warning/10 px-3 py-2.5 pg-hint text-warning">
              {isPremium ? (
                <>Мало отзывов — Premium: анализ из сети. Можно нажать «Запустить AI-анализ».</>
              ) : (
                <>
                  На странице мало отзывов (нужно {MIN_REVIEWS_FOR_ANALYSIS}). Откройте вкладку отзывов
                  на маркетплейсе или выберите другой товар.
                </>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
