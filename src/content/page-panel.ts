/**
 * Виджет на странице товара — как Palert / Keepa:
 * график истории, анализ скидки, кнопки «Следить» и «Сравнить», целевая цена.
 */
import { safeRuntimeSend } from '@/lib/extension-context';
import { analyzePriceHistory, buildMiniChartSvg } from '@/lib/price-insights';
import { formatPrice } from '@/lib/utils';
import type { PricePoint, Product } from '@/types/product';

const PANEL_ID = 'priceguard-page-panel';

interface PanelState {
  product: Product;
  history: PricePoint[];
  isTracked: boolean;
  targetPrice?: number;
}

let hostEl: HTMLElement | null = null;
let shadowRoot: ShadowRoot | null = null;
let collapsed = false;

const PANEL_CSS = `
  :host { all: initial; }
  .pg-wrap {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    font-size: 13px;
    color: #0f172a;
    background: #fff;
    border: 1px solid #e2e8f0;
    border-radius: 12px;
    box-shadow: 0 8px 30px rgba(15,23,42,.12);
    width: 300px;
    overflow: hidden;
    z-index: 2147483646;
  }
  .pg-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 12px;
    background: linear-gradient(135deg, #4f46e5, #7c3aed);
    color: #fff;
  }
  .pg-header strong { font-size: 13px; }
  .pg-header button {
    background: rgba(255,255,255,.2);
    border: none;
    color: #fff;
    width: 24px;
    height: 24px;
    border-radius: 6px;
    cursor: pointer;
    font-size: 14px;
  }
  .pg-body { padding: 12px; }
  .pg-price { font-size: 22px; font-weight: 700; color: #4f46e5; }
  .pg-old { font-size: 12px; color: #94a3b8; text-decoration: line-through; margin-left: 6px; }
  .pg-stats {
    display: flex;
    gap: 8px;
    margin: 8px 0;
    font-size: 11px;
    color: #64748b;
  }
  .pg-stats span { background: #f1f5f9; padding: 4px 8px; border-radius: 6px; }
  .pg-insight {
    margin: 8px 0;
    padding: 8px 10px;
    border-radius: 8px;
    font-size: 11px;
    line-height: 1.4;
  }
  .pg-insight.great, .pg-insight.good { background: #ecfdf5; color: #047857; }
  .pg-insight.average { background: #f8fafc; color: #475569; }
  .pg-insight.high, .pg-insight.fake { background: #fef2f2; color: #b91c1c; }
  .pg-chart { margin: 8px 0; border-radius: 8px; background: #f8fafc; }
  .pg-actions { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 10px; }
  .pg-actions button {
    padding: 8px;
    border-radius: 8px;
    border: none;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
  }
  .pg-track { background: #4f46e5; color: #fff; }
  .pg-track.active { background: #64748b; }
  .pg-compare { background: #f1f5f9; color: #334155; border: 1px solid #e2e8f0; }
  .pg-target {
    margin-top: 10px;
    display: flex;
    gap: 6px;
    align-items: center;
  }
  .pg-target input {
    flex: 1;
    padding: 6px 8px;
    border: 1px solid #e2e8f0;
    border-radius: 6px;
    font-size: 12px;
  }
  .pg-target button {
    padding: 6px 10px;
    background: #f1f5f9;
    border: 1px solid #e2e8f0;
    border-radius: 6px;
    font-size: 11px;
    cursor: pointer;
  }
  .pg-footer { font-size: 10px; color: #94a3b8; margin-top: 8px; text-align: center; }
  .pg-collapsed .pg-body { display: none; }
`;

function insightClass(kind: string): string {
  if (kind === 'great_deal' || kind === 'good_price') return 'great';
  if (kind === 'fake_discount' || kind === 'unconfirmed_strikethrough' || kind === 'high_price') {
    return 'fake';
  }
  return 'average';
}

function renderPanel(state: PanelState): void {
  if (!shadowRoot) return;

  const { product, history, isTracked, targetPrice } = state;
  const insight = analyzePriceHistory(history, product.price, product.oldPrice);

  shadowRoot.innerHTML = `
    <style>${PANEL_CSS}</style>
    <div class="pg-wrap ${collapsed ? 'pg-collapsed' : ''}">
      <div class="pg-header">
        <strong>🛡 PriceGuard</strong>
        <button type="button" data-action="toggle" title="Свернуть">${collapsed ? '▲' : '▼'}</button>
      </div>
      <div class="pg-body">
        <div>
          <span class="pg-price">${formatPrice(product.price)}</span>
          ${product.oldPrice && product.oldPrice > product.price ? `<span class="pg-old">${formatPrice(product.oldPrice)}</span>` : ''}
        </div>
        <div class="pg-stats">
          ${insight.minPrice != null ? `<span>Мин: ${formatPrice(insight.minPrice)}</span>` : ''}
          ${insight.maxPrice != null ? `<span>Макс: ${formatPrice(insight.maxPrice)}</span>` : ''}
          ${insight.avgPrice != null ? `<span>Сред: ${formatPrice(insight.avgPrice)}</span>` : ''}
        </div>
        <div class="pg-chart">${buildMiniChartSvg(history)}</div>
        <div class="pg-insight ${insightClass(insight.kind)}">
          <strong>${insight.label}</strong><br>${insight.detail}
        </div>
        <div class="pg-actions">
          <button type="button" class="pg-track ${isTracked ? 'active' : ''}" data-action="track">
            ${isTracked ? '✓ Отслеживается' : '🔔 Следить'}
          </button>
          <button type="button" class="pg-compare" data-action="compare">⚖ Сравнить</button>
        </div>
        ${isTracked ? `
          <div class="pg-target">
            <input type="number" data-input="target" placeholder="Целевая цена ₽" value="${targetPrice ?? ''}" />
            <button type="button" data-action="set-target">OK</button>
          </div>
        ` : ''}
      </div>
    </div>
  `;

  shadowRoot.querySelector('[data-action="toggle"]')?.addEventListener('click', () => {
    collapsed = !collapsed;
    renderPanel(state);
  });

  shadowRoot.querySelector('[data-action="track"]')?.addEventListener('click', () => {
    void safeRuntimeSend({
      type: isTracked ? 'UNTRACK_PRODUCT' : 'TRACK_FROM_PANEL',
      payload: isTracked ? { productId: product.id } : { product },
    }).then(() => refreshPanel(product));
  });

  shadowRoot.querySelector('[data-action="compare"]')?.addEventListener('click', () => {
    void (async () => {
      const response = await safeRuntimeSend<{
        ok?: boolean;
        error?: string;
        started?: boolean;
      }>({
        type: 'ENSURE_COMPARE_PRODUCT',
        payload: {
          url: product.url,
          article: product.article,
          title: product.title,
          price: product.price,
          oldPrice: product.oldPrice,
          forceCompare: true,
          authenticity: product.authenticity,
        },
      });

      if (!response?.ok) {
        showToast(response?.error ?? 'Не удалось добавить в сравнение');
        return;
      }

      showToast(
        response.started
          ? 'Добавлено в сравнение — ищем цены на других площадках'
          : 'Товар добавлен в сравнение — откройте расширение',
      );
    })();
  });

  shadowRoot.querySelector('[data-action="set-target"]')?.addEventListener('click', () => {
    const input = shadowRoot?.querySelector<HTMLInputElement>('[data-input="target"]');
    const value = parseInt(input?.value ?? '', 10);
    if (!value || value <= 0) return;
    void safeRuntimeSend({
      type: 'SET_TARGET_PRICE',
      payload: { productId: product.id, targetPrice: value },
    });
    showToast(`Уведомим при цене ≤ ${formatPrice(value)}`);
    void refreshPanel(product);
  });
}

function showToast(text: string): void {
  const toast = document.createElement('div');
  toast.textContent = text;
  Object.assign(toast.style, {
    position: 'fixed',
    bottom: '24px',
    left: '50%',
    transform: 'translateX(-50%)',
    background: '#0f172a',
    color: '#fff',
    padding: '10px 16px',
    borderRadius: '8px',
    fontSize: '13px',
    zIndex: '2147483647',
    fontFamily: 'system-ui, sans-serif',
  });
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
}

function ensureHost(): ShadowRoot {
  if (hostEl && shadowRoot) return shadowRoot;

  hostEl = document.getElementById(PANEL_ID);
  if (!hostEl) {
    hostEl = document.createElement('div');
    hostEl.id = PANEL_ID;
    Object.assign(hostEl.style, {
      position: 'fixed',
      bottom: '20px',
      right: '20px',
      zIndex: '2147483646',
    });
    document.body.appendChild(hostEl);
  }

  shadowRoot = hostEl.shadowRoot ?? hostEl.attachShadow({ mode: 'open' });
  return shadowRoot;
}

async function loadPanelState(product: Product): Promise<PanelState> {
  const response = await safeRuntimeSend<{
    history?: PricePoint[];
    isTracked?: boolean;
    targetPrice?: number;
  }>({
    type: 'GET_PANEL_STATE',
    payload: { productId: product.id },
  });

  return {
    product,
    history: (response?.history as PricePoint[]) ?? [],
    isTracked: Boolean(response?.isTracked),
    targetPrice: response?.targetPrice as number | undefined,
  };
}

export async function refreshPanel(product: Product): Promise<void> {
  if (!product?.price) return;
  ensureHost();
  const state = await loadPanelState(product);
  renderPanel(state);
}

export function removePanel(): void {
  hostEl?.remove();
  hostEl = null;
  shadowRoot = null;
}

export async function showPagePanel(product: Product): Promise<void> {
  await refreshPanel(product);
}
