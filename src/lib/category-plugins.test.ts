import { describe, expect, it } from 'vitest';
import {
  CATEGORY_PLUGINS,
  buildMatchProfiles,
  getCategoryPlugin,
  inferCategoryFromPlugins,
} from '@/lib/category-plugins';
import { MATCH_PROFILES, inferProductCategory, type ProductCategory } from '@/lib/match-category';

const ALL_CATEGORIES: ProductCategory[] = [
  'smartphones',
  'laptops',
  'gpus',
  'desktops',
  'monoblocks',
  'pc_components',
  'headphones',
  'wearables',
  'lenses',
  'cameras',
  'consoles',
  'power_tools',
  'appliances',
  'home_textile',
  'home_goods',
  'kids',
  'sports',
  'apparel',
  'shoes',
  'detergents',
  'cosmetics',
  'pet_food',
  'grocery',
  'memory_cards',
  'generic',
];

describe('category-plugins registry', () => {
  it('buildMatchProfiles matches MATCH_PROFILES facade', () => {
    expect(buildMatchProfiles()).toEqual(MATCH_PROFILES);
  });

  it('every non-generic category has a plugin with profile', () => {
    for (const id of ALL_CATEGORIES) {
      if (id === 'generic') continue;
      const plugin = getCategoryPlugin(id);
      expect(plugin, `missing plugin for ${id}`).toBeDefined();
      expect(plugin!.profile).toEqual(MATCH_PROFILES[id]);
    }
  });

  it('plugin ids are unique and ordered for inference', () => {
    const ids = CATEGORY_PLUGINS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).not.toContain('generic');
  });

  it('inferCategoryFromPlugins matches inferProductCategory', () => {
    const samples = [
      ['Смартфон Xiaomi Redmi 15C', 'smartphones'],
      ['Ноутбук ASUS 15.6"', 'laptops'],
      ['Фотоаппарат Canon EOS 650D', 'cameras'],
      ['Объектив Canon EF 50mm', 'lenses'],
      ['PlayStation 5', 'consoles'],
      ['Стиральный порошок Persil', 'detergents'],
      ['Случайный товар без категории', 'generic'],
    ] as const;

    for (const [title, expected] of samples) {
      expect(inferCategoryFromPlugins(title)).toBe(expected);
      expect(inferProductCategory(title)).toBe(expected);
    }
  });

  it('cameras plugin exposes mismatch penalty and stripQueryNoise', () => {
    const cameras = getCategoryPlugin('cameras');
    expect(cameras?.mismatchPenalty).toBeTypeOf('function');
    expect(cameras?.stripQueryNoise).toBeTypeOf('function');
    expect(cameras!.stripQueryNoise!('Canon EOS 650D Kit EF-S 18-55mm')).toMatch(/canon eos 650d/i);
    expect(cameras!.stripQueryNoise!('Canon EOS 650D Kit EF-S 18-55mm')).not.toMatch(/18-55/i);
  });
});
