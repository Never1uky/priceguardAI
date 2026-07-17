/**
 * Нечёткое сравнение строк (Levenshtein ratio) для confidence match в сравнении цен.
 */

/** Расстояние Левенштейна между двумя строками */
export function levenshteinDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  const rows = a.length + 1;
  const cols = b.length + 1;
  const matrix: number[] = new Array(rows * cols);

  for (let i = 0; i < rows; i++) matrix[i * cols] = i;
  for (let j = 0; j < cols; j++) matrix[j] = j;

  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const idx = i * cols + j;
      matrix[idx] = Math.min(
        matrix[(i - 1) * cols + j] + 1,
        matrix[i * cols + (j - 1)] + 1,
        matrix[(i - 1) * cols + (j - 1)] + cost,
      );
    }
  }

  return matrix[(rows - 1) * cols + (cols - 1)];
}

/** Сходство 0–1 на основе нормализованного Levenshtein ratio */
export function levenshteinSimilarity(a: string, b: string): number {
  if (!a || !b) return 0;
  const normA = a.toLowerCase().replace(/\s+/g, ' ').trim();
  const normB = b.toLowerCase().replace(/\s+/g, ' ').trim();
  if (!normA || !normB) return 0;
  if (normA === normB) return 1;

  const maxLen = Math.max(normA.length, normB.length);
  const dist = levenshteinDistance(normA, normB);
  return Math.max(0, 1 - dist / maxLen);
}

/** Процент сходства (0–100) для UI */
export function matchConfidencePercent(score: number): number {
  return Math.round(Math.min(1, Math.max(0, score)) * 100);
}
