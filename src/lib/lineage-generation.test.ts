import { describe, expect, it } from 'vitest';
import {
  areLineageGenerationsCompatible,
  extractLineageGeneration,
} from '@/lib/lineage-generation';

describe('lineage-generation P1 extractor', () => {
  it('extracts Dyson Supersonic HD model tokens', () => {
    expect(extractLineageGeneration('Фен Dyson Supersonic HD08')?.genKey).toBe('hd08');
    expect(areLineageGenerationsCompatible('Dyson Supersonic HD08', 'Dyson Supersonic HD07')).toBe(
      false,
    );
  });

  it('extracts tool family-model tokens like GSB 18V-50', () => {
    const gsb = extractLineageGeneration('Дрель Bosch GSB 18V-50');
    expect(gsb?.lineage).toBe('tool:gsb');
    expect(gsb?.genKey).toBe('gsb18v-50');
  });

  it('extracts robot S-line with explicit family context', () => {
    const model = extractLineageGeneration('Робот-пылесос Roborock S8 Max');
    expect(model?.lineage).toBe('robot:model');
    expect(model?.genKey).toBe('s8max');
    expect(
      areLineageGenerationsCompatible(
        'Робот-пылесос Roborock S8 Max',
        'Робот-пылесос Roborock S7',
      ),
    ).toBe(false);
  });
});
