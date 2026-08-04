/**
 * Единая семантика результата «В Мои товары»:
 * успех = товар в tracked ИЛИ compare; ENSURE fail при наличии в списке ≠ красный fail.
 */

import { findCompareProductByUrl } from '@/lib/compare-service';
import { getCompareProducts } from '@/lib/comparison-storage';
import { getTrackedProducts } from '@/lib/storage';
import { isSameProductPage } from '@/lib/reviews/tab-resolver';
import type { CompareProduct } from '@/types/comparison';

export type AddToMyProductsKind = 'ok' | 'partial' | 'limit' | 'fail';

export interface AddToMyProductsResult {
  kind: AddToMyProductsKind;
  message: string;
  compareId: string | null;
  inTracked: boolean;
  inCompare: boolean;
  researchStarted: boolean;
}

export interface ResolveAddToMyProductsInput {
  alreadyPresent?: boolean;
  wantResearch?: boolean;
  /** null = ENSURE не вызывали / нет ответа */
  ensureOk?: boolean | null;
  ensureError?: string | null;
  ensureStarted?: boolean;
  inTracked: boolean;
  inCompare: boolean;
  compareId?: string | null;
}

const LIMIT_MSG =
  'Лимит товаров в «Мои товары». Удалите лишние или оформите Premium.';
const PARTIAL_MSG =
  'Добавлен в «Мои товары». Поиск цен не запустился — откройте товар и нажмите «Найти заново».';
const FAIL_MSG = 'Не удалось добавить в «Мои товары»';
const RESEARCH_NOT_STARTED_MSG =
  'Поиск не запустился — откройте товар и нажмите «Найти заново»';

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function isTrackedMatch(
  tracked: { id: string; url?: string },
  ref: { id?: string; url: string },
): boolean {
  if (ref.id && tracked.id === ref.id) return true;
  if (tracked.url && ref.url && isSameProductPage(tracked.url, ref.url)) return true;
  return false;
}

/** Pure: storage snapshot + ENSURE flags → UI kind/message. */
export function resolveAddToMyProductsResult(
  input: ResolveAddToMyProductsInput,
): AddToMyProductsResult {
  const wantResearch = input.wantResearch !== false;
  const alreadyPresent = Boolean(input.alreadyPresent);
  const err = (input.ensureError ?? '').trim();
  const inTracked = input.inTracked;
  const inCompare = input.inCompare;
  const compareId = input.compareId ?? null;
  /** Only true when ENSURE/job actually started — never invent from inCompare alone. */
  const researchStarted = Boolean(input.ensureStarted);
  const inList = inTracked || inCompare;

  if (!inList) {
    if (/лимит/i.test(err)) {
      return {
        kind: 'limit',
        message: LIMIT_MSG,
        compareId: null,
        inTracked: false,
        inCompare: false,
        researchStarted: false,
      };
    }
    return {
      kind: 'fail',
      message: err || FAIL_MSG,
      compareId: null,
      inTracked: false,
      inCompare: false,
      researchStarted: false,
    };
  }

  const ensureFailed = input.ensureOk === false;

  if (ensureFailed && !researchStarted) {
    return {
      kind: 'partial',
      message: PARTIAL_MSG,
      compareId,
      inTracked,
      inCompare,
      researchStarted: false,
    };
  }

  if (researchStarted) {
    return {
      kind: 'ok',
      message: alreadyPresent
        ? 'Ищем цены на других площадках'
        : 'Товар в «Мои товары» — ищем цены на других площадках',
      compareId,
      inTracked,
      inCompare,
      researchStarted: true,
    };
  }

  if (wantResearch && inCompare) {
    return {
      kind: 'partial',
      message: RESEARCH_NOT_STARTED_MSG,
      compareId,
      inTracked,
      inCompare,
      researchStarted: false,
    };
  }

  return {
    kind: 'ok',
    message: alreadyPresent ? 'Открыто в «Мои товары»' : 'Товар в «Мои товары»',
    compareId,
    inTracked,
    inCompare,
    researchStarted: false,
  };
}

export async function lookupProductInMyLists(
  ref: { url: string; id?: string },
  options?: { retries?: number; delayMs?: number; compareIdHint?: string },
): Promise<{ inTracked: boolean; compare: CompareProduct | null }> {
  const retries = options?.retries ?? 2;
  const delayMs = options?.delayMs ?? 250;

  let compare: CompareProduct | null = null;
  let inTracked = false;

  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) await delay(delayMs);

    const [trackedList, byUrl] = await Promise.all([
      getTrackedProducts(),
      findCompareProductByUrl(ref.url),
    ]);

    compare = byUrl;
    if (!compare && options?.compareIdHint) {
      const all = await getCompareProducts();
      compare = all.find((p) => p.id === options.compareIdHint) ?? null;
    }

    inTracked = trackedList.some((p) => isTrackedMatch(p, ref));

    if (inTracked || compare) {
      return { inTracked, compare };
    }
  }

  return { inTracked, compare };
}

/**
 * После ENSURE: lookup + resolve. Не считает ensure.ok=true успехом без записи в storage.
 */
export async function resolveAfterEnsure(params: {
  product: { url: string; id?: string };
  alreadyPresent?: boolean;
  wantResearch?: boolean;
  ensure: {
    ok?: boolean;
    error?: string;
    started?: boolean;
    productId?: string;
  } | null;
}): Promise<AddToMyProductsResult> {
  const { inTracked, compare } = await lookupProductInMyLists(
    { url: params.product.url, id: params.product.id },
    { compareIdHint: params.ensure?.productId, retries: 2, delayMs: 280 },
  );

  return resolveAddToMyProductsResult({
    alreadyPresent: params.alreadyPresent,
    wantResearch: params.wantResearch,
    ensureOk: params.ensure?.ok ?? null,
    ensureError: params.ensure?.error ?? null,
    ensureStarted: params.ensure?.started,
    inTracked,
    inCompare: Boolean(compare),
    compareId: compare?.id ?? params.ensure?.productId ?? null,
  });
}
