/** Парсинг поля «Модель» из строки характеристик */
export function parseModelFromSpecsText(specs: string): string | null {
  if (!specs?.trim()) return null;

  const match =
    specs.match(/(?:модель|model|наименование модели)\s*[:：\-—]\s*([^·|;\n]+)/i) ??
    specs.match(/(?:модель|model)\s+([A-Za-zА-Яа-я0-9][^·|;\n]{2,60})/i);

  const value = match?.[1]?.trim();
  return value && value.length >= 3 ? value : null;
}

const MODEL_LABEL_RE = /^(модель|model|наименование модели)$/i;

/** Считать поле «Модель» с открытой карточки товара (content script) */
export function scrapeModelFieldFromDom(): string | null {
  for (const row of document.querySelectorAll('tr')) {
    const cells = row.querySelectorAll('th, td');
    if (cells.length < 2) continue;

    const label = cells[0].textContent?.trim() ?? '';
    if (!MODEL_LABEL_RE.test(label)) continue;

    const value = cells[1].textContent?.trim();
    if (value && value.length >= 3 && value.length < 120) return value;
  }

  for (const dt of document.querySelectorAll('dt')) {
    const label = dt.textContent?.trim() ?? '';
    if (!MODEL_LABEL_RE.test(label)) continue;

    const dd = dt.nextElementSibling;
    const value = dd?.textContent?.trim();
    if (value && value.length >= 3 && value.length < 120) return value;
  }

  for (const item of document.querySelectorAll('[class*="specification"], [class*="characteristic"]')) {
    const text = item.textContent ?? '';
    const fromText = parseModelFromSpecsText(text);
    if (fromText) return fromText;
  }

  return null;
}
