import { describe, expect, it } from 'vitest';
import { evaluateAuthenticity, scanHtmlForAuthenticity } from '@/lib/authenticity/detect-core';

const WB_ORIGINAL_CARD = `
<article class="product-card">
  <div class="product-card__top">
    <span class="original-mark"><svg><path d="check"/></svg> Оригинал</span>
    <h2 class="product-card__name">Apple Беспроводные наушники AirPods Max</h2>
  </div>
</article>`;

const WB_FAKE_CARD = `
<article class="product-card">
  <h2 class="product-card__name">Наушники беспроводные AirPro Max Gutovv</h2>
  <span class="price">5287 ₽</span>
</article>`;

const WB_PRODUCT_ORIGINAL = `
<main class="product-page">
  <div class="product-page__header">
    <span class="original-mark verified"><svg><circle/></svg> Оригинал</span>
    <h1 class="productTitle">Apple Беспроводные наушники AirPods Max</h1>
  </div>
</main>`;

const WB_PRODUCT_NO_BADGE = `
<main class="product-page">
  <h1 class="productTitle">Apple Беспроводные наушники AirPods Max</h1>
</main>`;

const WB_PRODUCT_REPLICA = `
<main class="product-page">
  <h1 class="productTitle">Apple AirPods Max реплика</h1>
</main>`;

const OZON_ORIGINAL = `
<div data-widget="webProductHeading">
  <div data-widget="webBrand">
    <svg class="verified-icon"></svg>
    <span>Оригинал</span>
    <a>Apple</a>
  </div>
  <h1>Apple AirPods Max</h1>
</div>`;

const OZON_NO_BADGE = `
<div data-widget="webProductHeading">
  <div data-widget="webBrand"><a>Apple</a></div>
  <h1>Apple AirPods Max</h1>
</div>`;

const OZON_ORIGINAL_TOVAR = `
<div data-widget="webProductHeading">
  <div data-widget="webBrand" class="original-badge">
    <svg class="verified"></svg>
    <span>Оригинальный товар</span>
  </div>
  <h1>Apple AirPods Max</h1>
</div>`;

const YANDEX_ORIGINAL = `
<main class="product-page">
  <div class="product-page__header">
    <span class="original-mark verified"><svg><path d="check"/></svg> Оригинал</span>
    <h1 data-auto="productCardTitle">Apple AirPods Max</h1>
  </div>
</main>`;

const YANDEX_NO_BADGE = `
<main class="product-page">
  <h1 data-auto="productCardTitle">Sony PlayStation 5 Slim</h1>
</main>`;

describe('scanHtmlForAuthenticity', () => {
  it('detects WB search card with Оригинал badge', () => {
    const r = scanHtmlForAuthenticity('wildberries', WB_ORIGINAL_CARD);
    expect(r.status).toBe('original');
  });

  it('flags counterfeit-looking WB title', () => {
    const r = scanHtmlForAuthenticity('wildberries', WB_FAKE_CARD);
    expect(r.status).toBe('not_original');
  });

  it('detects WB product page with original mark', () => {
    const r = scanHtmlForAuthenticity('wildberries', WB_PRODUCT_ORIGINAL);
    expect(r.status).toBe('original');
  });

  it('does not warn on branded WB page without badge (unknown)', () => {
    const r = scanHtmlForAuthenticity('wildberries', WB_PRODUCT_NO_BADGE);
    expect(r.status).toBe('unknown');
  });

  it('flags replica keyword', () => {
    const r = scanHtmlForAuthenticity('wildberries', WB_PRODUCT_REPLICA);
    expect(r.status).toBe('not_original');
  });

  it('detects Ozon original brand block', () => {
    const r = scanHtmlForAuthenticity('ozon', OZON_ORIGINAL);
    expect(r.status).toBe('original');
  });

  it('does not warn on Ozon Apple without badge', () => {
    const r = scanHtmlForAuthenticity('ozon', OZON_NO_BADGE);
    expect(r.status).toBe('unknown');
  });

  it('detects Ozon «Оригинальный товар» badge', () => {
    const r = scanHtmlForAuthenticity('ozon', OZON_ORIGINAL_TOVAR);
    expect(r.status).toBe('original');
  });

  it('detects Yandex Market original mark', () => {
    const r = scanHtmlForAuthenticity('yandex_market', YANDEX_ORIGINAL);
    expect(r.status).toBe('original');
  });

  it('does not warn on YM branded listing without badge', () => {
    const r = scanHtmlForAuthenticity('yandex_market', YANDEX_NO_BADGE);
    expect(r.status).toBe('unknown');
  });
});

describe('evaluateAuthenticity', () => {
  it('treats short Оригинал label as original', () => {
    const r = evaluateAuthenticity({
      marketplace: 'wildberries',
      title: 'Sony PlayStation 5 Slim',
      hasOriginalLabel: true,
      isProductPage: true,
    });
    expect(r.status).toBe('original');
  });

  it('warns only on counterfeit hints', () => {
    const r = evaluateAuthenticity({
      marketplace: 'wildberries',
      title: 'Часы Rolex копия 1:1',
      isProductPage: true,
    });
    expect(r.status).toBe('not_original');
  });
});
