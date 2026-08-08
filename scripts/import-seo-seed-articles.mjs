#!/usr/bin/env node
/**
 * Import SEO seed articles JSON → seo_product_pages (published)
 * and optionally product_cache v2 (synthetic seed:* product ids).
 *
 * Usage:
 *   node scripts/import-seo-seed-articles.mjs path/to/articles.json [--no-ai-cache]
 *
 * Env (from priceguard-seo/.env.local or process env):
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 *   SEO_SITE_ORIGIN (optional, default https://priceguard-seo.vercel.app)
 *   REVALIDATE_SECRET (optional — on-demand revalidate after upsert)
 */

import { createHash } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const FULL_PRODUCT_CACHE_VERSION = 2;
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const SEO_ROOT = resolve(ROOT, '..', 'priceguard-seo');

function loadEnvFile(path) {
  if (!existsSync(path)) return;
  const text = readFileSync(path, 'utf8');
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!m) continue;
    const key = m[1];
    let val = m[2].trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (process.env[key] == null || process.env[key] === '') {
      process.env[key] = val;
    }
  }
}

loadEnvFile(join(SEO_ROOT, '.env.local'));
loadEnvFile(join(ROOT, '.env'));

function slugify(raw, maxLen = 80) {
  const s = String(raw ?? '')
    .normalize('NFKD')
    .replace(/ё/gi, 'е')
    .toLowerCase()
    .replace(/[^a-z0-9а-я]+/gi, '-')
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return (s || 'item').slice(0, maxLen).replace(/-$/g, '') || 'item';
}

function normPart(s) {
  return String(s ?? '')
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[().,]/g, '')
    .trim();
}

function buildCanonId({ title, brand, category }) {
  const brandN = normPart(brand);
  const modelGuess = String(title ?? '')
    .replace(new RegExp(`^${brand}\\s+`, 'i'), '')
    .trim();
  const model = normPart(modelGuess || title);
  if (!brandN || !model) return null;
  const parts = [brandN, model, category ? String(category) : ''].filter(Boolean);
  return `canon:${parts.join('|')}`.slice(0, 160);
}

function stableHash(analysis) {
  const payload = JSON.stringify({
    qualityScore: analysis.qualityScore,
    qualitySummary: analysis.qualitySummary,
    webOverview: analysis.webOverview,
    pros: analysis.pros,
    cons: analysis.cons,
    fakeRisk: analysis.fakeRisk,
    fakeRiskExplanation: analysis.fakeRiskExplanation,
    verdict: analysis.verdict,
    verdictExplanation: analysis.verdictExplanation,
    keySpecs: analysis.keySpecs,
    hiddenProblems: analysis.hiddenProblems,
    alternatives: analysis.alternatives,
    analogComparison: analysis.analogComparison,
    source: analysis.source,
  });
  return createHash('sha256').update(payload).digest('hex');
}

function ensureTitle(title, brand, category) {
  let t = String(title ?? '').trim();
  if (t.length < 8 && brand && !t.toLowerCase().startsWith(String(brand).toLowerCase())) {
    t = `${brand} ${t}`.trim();
  }
  if (t.length < 8 && category) t = `${t} ${category}`.trim();
  if (t.length < 8) t = `${t} обзор`.trim();
  return t;
}

function parseArticles(raw) {
  const data = JSON.parse(raw);
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.articles)) return data.articles;
  throw new Error('Expected array or { articles: [...] }');
}

async function notifyRevalidate(paths) {
  const origin = (process.env.SEO_SITE_ORIGIN || 'https://priceguard-seo.vercel.app')
    .trim()
    .replace(/\/$/, '');
  const secret = (process.env.REVALIDATE_SECRET || '').trim();
  if (!secret || paths.length === 0) {
    console.log('revalidate: skipped (no REVALIDATE_SECRET)');
    return;
  }
  const res = await fetch(`${origin}/api/revalidate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-revalidate-secret': secret,
    },
    body: JSON.stringify({ paths }),
  });
  const body = await res.text();
  console.log(`revalidate: HTTP ${res.status} ${body.slice(0, 200)}`);
}

async function main() {
  const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const noAiCache = process.argv.includes('--no-ai-cache');
  const file = args[0];
  if (!file) {
    console.error('Usage: node scripts/import-seo-seed-articles.mjs <articles.json> [--no-ai-cache]');
    process.exit(2);
  }

  const url = process.env.SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) {
    console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
  }

  const articles = parseArticles(readFileSync(resolve(file), 'utf8'));
  const supabase = createClient(url, key, { auth: { persistSession: false } });
  const nowIso = new Date().toISOString();
  const revalidatePaths = new Set(['/', '/sitemap.xml', '/rss.xml']);
  const results = [];

  for (let i = 0; i < articles.length; i++) {
    const item = articles[i];
    const slug = String(item.slug || '').trim();
    const marketplace = String(item.marketplaceHint || 'wildberries').trim();
    if (!slug || !['wildberries', 'ozon', 'yandex_market'].includes(marketplace)) {
      results.push({ slug, ok: false, error: 'bad slug/marketplace' });
      continue;
    }

    const title = ensureTitle(item.title, item.brand, item.category);
    const brand = item.brand ? String(item.brand).trim() : null;
    const category = item.category ? String(item.category).trim() : null;
    const brandSlug = brand ? slugify(brand) : null;
    const categorySlug = item.categorySlug
      ? slugify(String(item.categorySlug))
      : category
        ? slugify(category)
        : null;
    const productId = `seed-${slug}`.slice(0, 64);
    const productKey = `${marketplace}:${productId}`;
    const analysis = { ...(item.analysis || {}) };
    if (!analysis.analyzedAt) analysis.analyzedAt = Date.now();
    if (item.articleMarkdown) analysis.seoArticleMarkdown = item.articleMarkdown;
    if (Array.isArray(item.faq) && item.faq.length) analysis.seoFaq = item.faq;

    const qualityScore =
      typeof analysis.qualityScore === 'number' ? analysis.qualityScore : null;
    const reviewCount = Number(item.reviewCount ?? 0) || 0;
    const price =
      item.priceCurrentRub != null && Number(item.priceCurrentRub) > 0
        ? Number(item.priceCurrentRub)
        : null;
    const rating =
      item.rating != null && Number(item.rating) > 0 ? Number(item.rating) : null;
    const canonId = buildCanonId({ title, brand, category });
    const analysisHash = stableHash(analysis);

    const row = {
      slug,
      canonical_path: `/a/${slug}`,
      marketplace,
      product_id: productId,
      product_key: productKey,
      title,
      brand,
      brand_slug: brandSlug,
      category,
      category_slug: categorySlug,
      analysis_snapshot: analysis,
      analysis_hash: analysisHash,
      analyzed_at: nowIso,
      offers_snapshot: [],
      price_current: price,
      currency: String(item.currency || 'RUB'),
      image_url: null,
      product_url: null,
      quality_score: qualityScore,
      review_count: reviewCount,
      rating,
      publish_status: 'published',
      reject_reason: null,
      published_at: nowIso,
      updated_at: nowIso,
      canon_id: canonId,
      is_primary: true,
      primary_slug: null,
    };

    // Prefer upsert by product_key; if slug already owned by another key, update that row.
    let error = null;
    {
      const up = await supabase.from('seo_product_pages').upsert(row, {
        onConflict: 'product_key',
      });
      error = up.error;
      if (error && /slug_unique|duplicate key/i.test(error.message || '')) {
        const { data: bySlug } = await supabase
          .from('seo_product_pages')
          .select('product_key')
          .eq('slug', slug)
          .maybeSingle();
        if (bySlug?.product_key) {
          const patch = { ...row, product_key: bySlug.product_key };
          // Keep existing marketplace/product_id tied to that product_key
          const [mp, ...rest] = String(bySlug.product_key).split(':');
          if (mp && rest.length) {
            patch.marketplace = mp;
            patch.product_id = rest.join(':');
          }
          const upd = await supabase
            .from('seo_product_pages')
            .update(patch)
            .eq('slug', slug);
          error = upd.error;
          if (!error) {
            console.log(`UPDATE ${slug} (existing key ${bySlug.product_key})`);
          }
        }
      }
    }

    if (error) {
      results.push({ slug, ok: false, error: error.message });
      console.error(`FAIL ${slug}: ${error.message}`);
      continue;
    }

    if (!noAiCache) {
      const { error: cacheErr } = await supabase.from('product_cache').upsert(
        {
          marketplace,
          product_id: productId,
          product_title: title,
          model: null,
          raw_reviews: [],
          ai_analysis: analysis,
          last_updated: nowIso,
          cache_version: FULL_PRODUCT_CACHE_VERSION,
        },
        { onConflict: 'marketplace,product_id,cache_version' },
      );
      if (cacheErr) {
        console.warn(`cache warn ${slug}: ${cacheErr.message}`);
      }
    }

    revalidatePaths.add(`/a/${slug}`);
    if (brandSlug) revalidatePaths.add(`/brand/${brandSlug}`);
    if (categorySlug) revalidatePaths.add(`/category/${categorySlug}`);
    results.push({ slug, ok: true, productKey, title });
    console.log(`OK ${slug} → ${productKey}`);
  }

  await notifyRevalidate([...revalidatePaths]);

  const ok = results.filter((r) => r.ok).length;
  const fail = results.filter((r) => !r.ok);
  console.log(`\nDone: ${ok}/${articles.length} published`);
  if (fail.length) {
    console.error('Failures:', fail);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
