import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { SectionLabel } from '@/components/ui/section-label';
import { Surface } from '@/components/ui/surface';
import { trackProduct } from '@/lib/storage';
import { canTrackMoreProducts } from '@/lib/subscription';
import { AI_AUTH_REQUIRED_MESSAGE } from '@/lib/supabase/auth-guard';
import {
  agentStatusLabel,
  type AgentOfferRow,
} from '@/lib/shopping-agent-result';
import { formatPrice } from '@/lib/utils';
import { useShoppingAgent } from '@/popup/hooks/useShoppingAgent';
import { ProductLink } from '@/popup/components/ProductLink';
import { toastSuccess, toastUserError } from '@/popup/lib/toast';
import { marketplaceBadgeVariant, MARKETPLACE_SHORT_LABELS, extractArticle } from '@/utils/marketplace';
import { offerLinkUrl } from '@/utils/product-url';
import type { Product } from '@/types/product';
import { ExternalLink, Loader2, LogIn, PackagePlus, Sparkles } from 'lucide-react';
import { useState, type FormEvent } from 'react';

const EXAMPLES = ['тихий пылесос до 15000', 'Google Pixel 8'] as const;

interface ShoppingAgentPanelProps {
  onOpenAuth?: () => void;
}

function candidateToProduct(row: AgentOfferRow): Product {
  const url = offerLinkUrl(row.url, row.marketplace);
  const article = row.productId || extractArticle(url, row.marketplace);
  return {
    id: `${row.marketplace}-${article || url}`,
    marketplace: row.marketplace,
    title: row.title,
    price: row.price && row.price > 0 ? row.price : 0,
    currency: 'RUB',
    article: article || '',
    url,
    imageUrl: row.imageUrl,
    scrapedAt: Date.now(),
  };
}

export function ShoppingAgentPanel({ onOpenAuth }: ShoppingAgentPanelProps) {
  const agent = useShoppingAgent();
  const [trackingUrl, setTrackingUrl] = useState<string | null>(null);

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!agent.authed) {
      onOpenAuth?.();
      return;
    }
    void agent.start();
  };

  const handleTrack = async (row: AgentOfferRow) => {
    const product = candidateToProduct(row);
    setTrackingUrl(product.url);
    try {
      const { allowed, limit } = await canTrackMoreProducts();
      if (!allowed) {
        toastUserError(
          `Лимит: ${limit} товаров в «Мои товары». Удалите лишние или оформите Premium.`,
        );
        return;
      }
      await trackProduct(product);
      toastSuccess('Добавлено в «Мои товары»');
    } catch (error) {
      toastUserError(error instanceof Error ? error.message : 'Не удалось добавить товар');
    } finally {
      setTrackingUrl(null);
    }
  };

  const failedMessage =
    agent.searchState?.status === 'failed'
      ? agent.searchState.error || agent.result?.error || 'Не удалось подобрать товары'
      : null;

  return (
    <div className="space-y-3">
      <SectionLabel>Подобрать товар</SectionLabel>
      <p className="pg-hint">
        Опишите, что ищете — подберём на Wildberries, Ozon и Яндекс.Маркете.
      </p>

      {agent.authed === false && (
        <Surface variant="subtle" padding="sm" className="space-y-2">
          <p className="pg-body">{AI_AUTH_REQUIRED_MESSAGE}</p>
          {onOpenAuth && (
            <Button size="sm" onClick={onOpenAuth}>
              <LogIn className="h-3.5 w-3.5" strokeWidth={1.75} />
              Войти
            </Button>
          )}
        </Surface>
      )}

      <form onSubmit={handleSubmit} className="space-y-2">
        <textarea
          value={agent.query}
          onChange={(e) => agent.setQuery(e.target.value)}
          rows={2}
          maxLength={500}
          placeholder="Например: тихий пылесос до 15000"
          disabled={agent.inProgress}
          className="w-full resize-none rounded-sm border border-border bg-background px-3 py-2 pg-body outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
        />
        <div className="flex flex-wrap gap-1.5">
          {EXAMPLES.map((example) => (
            <button
              key={example}
              type="button"
              disabled={agent.inProgress}
              onClick={() => agent.setQuery(example)}
              className="rounded-full border border-border bg-muted/40 px-2 py-0.5 pg-caption text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
            >
              {example}
            </button>
          ))}
        </div>
        <Button
          type="submit"
          className="w-full"
          disabled={agent.inProgress || !agent.query.trim() || agent.authed === false}
        >
          {agent.inProgress ? (
            <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.75} />
          ) : (
            <Sparkles className="h-4 w-4" strokeWidth={1.75} />
          )}
          {agent.inProgress ? 'Подбираем…' : 'Подобрать'}
        </Button>
      </form>

      {agent.submitError && (
        <Surface variant="subtle" padding="sm" className="bg-destructive/10">
          <p className="pg-body text-destructive">{agent.submitError}</p>
        </Surface>
      )}

      {agent.inProgress && (
        <Surface variant="subtle" padding="sm" className="flex items-center gap-2">
          <Loader2 className="h-4 w-4 shrink-0 animate-spin text-primary" strokeWidth={1.75} />
          <div className="min-w-0">
            <p className="pg-subtitle">
              {agentStatusLabel(agent.searchState?.status ?? 'pending')}
            </p>
            {agent.searchState && agent.searchState.steps_taken > 0 && (
              <p className="pg-caption mt-0.5">шаг {agent.searchState.steps_taken}</p>
            )}
          </div>
        </Surface>
      )}

      {failedMessage && (
        <Surface variant="subtle" padding="sm" className="bg-destructive/10">
          <p className="pg-body text-destructive">{failedMessage}</p>
        </Surface>
      )}

      {agent.result?.status === 'done' && (
        <div className="space-y-2">
          {agent.result.summary && (
            <Surface variant="subtle" padding="sm">
              <p className="pg-body">{agent.result.summary}</p>
            </Surface>
          )}
          {agent.result.disclosure && (
            <p className="rounded-md bg-warning/10 px-3 py-2 pg-hint text-warning">
              Подбор упёрся в лимит шагов — ниже то, что удалось найти.
            </p>
          )}
          {agent.offers.length === 0 ? (
            <p className="pg-hint text-center">Подходящих товаров не нашлось.</p>
          ) : (
            <ul className="space-y-2">
              {agent.offers.map((row) => {
                const href = offerLinkUrl(row.url, row.marketplace);
                const tracking = trackingUrl === href;
                return (
                  <li key={`${row.marketplace}-${row.productId ?? row.url}`}>
                    <Surface padding="sm" className="space-y-2">
                      <div className="flex items-start justify-between gap-2">
                        <Badge variant={marketplaceBadgeVariant(row.marketplace)}>
                          {MARKETPLACE_SHORT_LABELS[row.marketplace]}
                        </Badge>
                        {row.price != null && row.price > 0 && (
                          <span className="pg-subtitle tabular-nums text-primary">
                            {formatPrice(row.price)}
                          </span>
                        )}
                      </div>
                      <p className="line-clamp-3 pg-body">{row.title}</p>
                      {(row.rankReason || row.reason) && (
                        <p className="pg-hint">{row.rankReason || row.reason}</p>
                      )}
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          className="min-w-0 flex-1"
                          disabled={tracking}
                          onClick={() => void handleTrack(row)}
                        >
                          {tracking ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.75} />
                          ) : (
                            <PackagePlus className="h-3.5 w-3.5" strokeWidth={1.75} />
                          )}
                          В «Мои товары»
                        </Button>
                        <ProductLink
                          url={href}
                          marketplace={row.marketplace}
                          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:bg-muted hover:text-foreground"
                          title="Открыть на площадке"
                          aria-label="Открыть на площадке"
                        >
                          <ExternalLink className="h-3.5 w-3.5" strokeWidth={1.75} />
                        </ProductLink>
                      </div>
                    </Surface>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
