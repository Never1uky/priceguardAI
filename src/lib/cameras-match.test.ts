import { describe, expect, it } from 'vitest';
import {
  areCategoriesIncompatible,
  inferProductCategory,
  isTitleCategoryCompatible,
} from '@/lib/match-category';
import {
  cameraBodyMismatchPenalty,
  extractProductModel,
  stripCameraKitNoise,
} from '@/lib/model-extract';
import { scoreProductMatch } from '@/lib/product-match';

describe('cameras category', () => {
  it('infers cameras from title', () => {
    expect(inferProductCategory('Фотоаппарат Canon EOS 650D Kit EF-S 18-55mm')).toBe('cameras');
  });

  it('extracts canon eos model', () => {
    const info = extractProductModel('Фотоаппарат Canon EOS 650D Kit EF-S 18-55mm III');
    expect(info.model.toLowerCase()).toMatch(/650/);
    expect(info.searchQuery.toLowerCase()).toMatch(/canon|650/);
  });

  it('stripCameraKitNoise removes lens from query', () => {
    const q = stripCameraKitNoise('Canon EOS 650D Kit EF-S 18-55mm');
    expect(q.toLowerCase()).toMatch(/650/);
    expect(q.toLowerCase()).not.toMatch(/18-55/);
  });

  it('cameraBodyMismatchPenalty penalizes 650D vs 600D', () => {
    expect(
      cameraBodyMismatchPenalty(
        'Фотоаппарат Canon EOS 650D',
        'Фотоаппарат Canon EOS 600D',
      ),
    ).toBeGreaterThan(0.5);
    expect(
      cameraBodyMismatchPenalty(
        'Фотоаппарат Canon EOS 650D',
        'Фотоаппарат Canon EOS 650D Kit',
      ),
    ).toBe(0);
  });

  it('scoreProductMatch ranks same camera model higher', () => {
    const ref = 'Фотоаппарат Canon EOS 650D EF-S 18-55mm';
    const same = scoreProductMatch(ref, 'Canon EOS 650D body', undefined, 'cameras');
    const diff = scoreProductMatch(ref, 'Canon EOS 600D Kit', undefined, 'cameras');
    expect(same).toBeGreaterThan(diff);
  });

  it('Nikon D810 vs D750 — lower score for wrong body', () => {
    const ref = 'Фотоаппарат Nikon D810 body';
    const same = scoreProductMatch(ref, 'Nikon D810 FX', undefined, 'cameras');
    const diff = scoreProductMatch(ref, 'Nikon D750 body', undefined, 'cameras');
    expect(
      cameraBodyMismatchPenalty('Nikon D810', 'Nikon D750'),
    ).toBeGreaterThan(0.5);
    expect(same).toBeGreaterThan(diff);
  });

  it('Nikon D5100 camera vs battery/case → accessories, score 0', () => {
    const ref = 'Фотоаппарат Nikon D5100 kit 18-105mm, 16 МП, Full HD';
    expect(inferProductCategory(ref)).toBe('cameras');
    expect(inferProductCategory('Аккумулятор EN-EL14 для Nikon D5100')).toBe('accessories');
    expect(inferProductCategory('Сумка POLO для Nikon D7100')).toBe('accessories');
    expect(areCategoriesIncompatible('cameras', 'accessories')).toBe(true);
    expect(isTitleCategoryCompatible(ref, 'Аккумулятор EN-EL14 для Nikon D5100')).toBe(false);
    expect(scoreProductMatch(ref, 'Аккумулятор EN-EL14 для Nikon D5100')).toBe(0);
    expect(scoreProductMatch(ref, 'Чехол для фотоаппарата Nikon D5100')).toBe(0);
  });
});
