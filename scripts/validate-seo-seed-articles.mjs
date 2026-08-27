#!/usr/bin/env node
/**
 * Validate SEO seed articles JSON (from external LLM batch) against
 * publish-gates + article shape expected for landing / seo_product_pages import.
 *
 * Usage:
 *   node scripts/validate-seo-seed-articles.mjs path/to/articles.json
 *   npm run validate:seo-seed -- path/to/articles.json
 *
 * Exit 0 = all ok; 1 = validation errors (printed to stderr).
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const SEO_MIN_QUALITY_SCORE = 6;
const SEO_MIN_WEB_OVERVIEW_LEN = 80;
const SEO_MIN_PROS = 2;
const SEO_MIN_CONS = 1;
const SEO_MIN_TITLE_LEN = 8;
const MIN_ARTICLES = 20;
const MIN_ARTICLE_CHARS = 2500; // ~700 Russian words rough lower bound

const VERDICTS = new Set(['buy_now', 'wait_discount', 'not_recommended']);
const FAKE_RISKS = new Set(['low', 'medium', 'high']);

function nonEmpty(s) {
  return typeof s === 'string' && s.trim().length > 0;
}

function asList(v) {
  if (!Array.isArray(v)) return [];
  return v.filter((x) => typeof x === 'string' && x.trim()).map((x) => x.trim());
}

function isWeakTitle(title) {
  const t = (title ?? '').trim();
  if (t.length < SEO_MIN_TITLE_LEN) return true;
  if (/\bSEO\s*Smoke\b/i.test(t)) return true;
  if (/\b(smoke\s*fixture|test\s*fixture)\b/i.test(t)) return true;
  if (/^(test|fixture|asdf|xxx)\b/i.test(t)) return true;
  if (
    /\b(wildberries|wb|ozon|яндекс\.?\s*маркет|yandex\s*market|megamarket|мегамаркет|aliexpress|алиэкспресс|mvideo|м\.?видео|dns|citilink|ситилинк|lamoda|ламода)\b/i.test(
      t,
    )
  ) {
    return true;
  }
  return false;
}

function validateAnalysis(a, idx, errors) {
  const p = `articles[${idx}].analysis`;
  if (!a || typeof a !== 'object') {
    errors.push(`${p}: missing object`);
    return;
  }
  const score = Number(a.qualityScore);
  if (!Number.isFinite(score) || score < SEO_MIN_QUALITY_SCORE || score > 10) {
    errors.push(`${p}.qualityScore: need ${SEO_MIN_QUALITY_SCORE}–10, got ${a.qualityScore}`);
  }
  if (!nonEmpty(a.qualitySummary)) errors.push(`${p}.qualitySummary: required`);
  if (!nonEmpty(a.verdictExplanation)) errors.push(`${p}.verdictExplanation: required`);
  if (!nonEmpty(a.webOverview) || a.webOverview.trim().length < SEO_MIN_WEB_OVERVIEW_LEN) {
    errors.push(`${p}.webOverview: need ≥${SEO_MIN_WEB_OVERVIEW_LEN} chars`);
  }
  if (!VERDICTS.has(a.verdict)) errors.push(`${p}.verdict: invalid (${a.verdict})`);
  if (!FAKE_RISKS.has(a.fakeRisk)) errors.push(`${p}.fakeRisk: invalid (${a.fakeRisk})`);
  if (!nonEmpty(a.fakeRiskExplanation)) errors.push(`${p}.fakeRiskExplanation: required`);

  const pros = asList(a.pros);
  const cons = asList(a.cons);
  if (pros.length < SEO_MIN_PROS) errors.push(`${p}.pros: need ≥${SEO_MIN_PROS}`);
  if (cons.length < SEO_MIN_CONS) errors.push(`${p}.cons: need ≥${SEO_MIN_CONS}`);

  if (a.source === 'local') {
    errors.push(`${p}.source: must not be "local" for SEO publish`);
  }
}

function validateArticle(item, idx, errors, slugs) {
  const p = `articles[${idx}]`;
  if (!item || typeof item !== 'object') {
    errors.push(`${p}: not an object`);
    return;
  }
  if (!nonEmpty(item.slug)) errors.push(`${p}.slug: required`);
  else if (slugs.has(item.slug)) errors.push(`${p}.slug: duplicate "${item.slug}"`);
  else slugs.add(item.slug);

  if (isWeakTitle(item.title)) {
    errors.push(`${p}.title: weak / smoke / marketplace / too short: "${item.title}"`);
  }
  if (!nonEmpty(item.brand)) errors.push(`${p}.brand: required`);

  const md = typeof item.articleMarkdown === 'string' ? item.articleMarkdown : '';
  if (md.trim().length < MIN_ARTICLE_CHARS) {
    errors.push(
      `${p}.articleMarkdown: too short (${md.trim().length} chars, want ≥${MIN_ARTICLE_CHARS})`,
    );
  }
  if (md && !/^#\s+/m.test(md)) {
    errors.push(`${p}.articleMarkdown: missing H1 (# …)`);
  }

  validateAnalysis(item.analysis, idx, errors);

  const reviewCount = Number(item.reviewCount ?? 0);
  const webLen = (item.analysis?.webOverview ?? '').trim().length;
  if (reviewCount < 5 && webLen < SEO_MIN_WEB_OVERVIEW_LEN) {
    errors.push(`${p}: insufficient_reviews gate (reviewCount < 5 and thin webOverview)`);
  }
}

function main() {
  const file = process.argv[2];
  if (!file) {
    console.error('Usage: node scripts/validate-seo-seed-articles.mjs <articles.json>');
    process.exit(2);
  }
  const abs = resolve(file);
  let raw;
  try {
    raw = readFileSync(abs, 'utf8');
  } catch (e) {
    console.error(`Cannot read ${abs}:`, e.message);
    process.exit(2);
  }

  let data;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    console.error('Invalid JSON:', e.message);
    process.exit(1);
  }

  const articles = Array.isArray(data) ? data : data?.articles;
  if (!Array.isArray(articles)) {
    console.error('Expected a JSON array, or { "articles": [...] }');
    process.exit(1);
  }

  const errors = [];
  if (articles.length < MIN_ARTICLES) {
    errors.push(`Need ≥${MIN_ARTICLES} articles, got ${articles.length}`);
  }

  const slugs = new Set();
  articles.forEach((item, i) => validateArticle(item, i, errors, slugs));

  if (errors.length) {
    console.error(`FAIL: ${errors.length} issue(s) in ${abs}\n`);
    for (const e of errors) console.error(` - ${e}`);
    process.exit(1);
  }

  console.log(
    `OK: ${articles.length} articles, ${slugs.size} unique slugs — publish-gates shape looks good.`,
  );
}

main();
