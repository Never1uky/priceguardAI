import { describe, expect, it } from 'vitest';
import {
  focusAxesForCategorySlug,
  formatFocusAxesPromptBlock,
} from './category-focus.ts';

describe('category-focus', () => {
  it('returns headphones axes', () => {
    expect(focusAxesForCategorySlug('headphones')).toContain('звук');
    expect(focusAxesForCategorySlug('headphones')).toContain('микрофон');
  });

  it('falls back to default', () => {
    expect(focusAxesForCategorySlug(null)).toContain('качество');
    expect(focusAxesForCategorySlug('unknown_xyz')).toContain('удобство');
  });

  it('formats prompt block', () => {
    const block = formatFocusAxesPromptBlock('smartphones');
    expect(block).toContain('камера');
    expect(block).toContain('Не выдумывай');
  });
});
