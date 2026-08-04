import { describe, expect, it, vi, beforeEach } from 'vitest';
import { hashQuery, redactData, redactUrl } from './redact';
import { shouldStoreLevel } from './sample';

describe('telemetry redact', () => {
  it('hashes query stably', () => {
    expect(hashQuery('iPhone 15 128')).toBe(hashQuery('iphone 15 128'));
    expect(hashQuery('a')).not.toBe(hashQuery('b'));
  });

  it('strips query from urls', () => {
    expect(redactUrl('https://www.wildberries.ru/catalog/1/detail.aspx?utm=x')).toBe(
      'https://www.wildberries.ru/catalog/1/detail.aspx',
    );
  });

  it('drops prompt/token fields', () => {
    const out = redactData({
      prompt: 'secret',
      title: 'Nice Phone',
      token: 'abc',
      score: 12,
    });
    expect(out?.prompt).toBeUndefined();
    expect(out?.token).toBeUndefined();
    expect(out?.score).toBe(12);
    expect(out?.title).toBe('Nice Phone');
  });
});

describe('telemetry sample', () => {
  it('silent stores only errors', () => {
    expect(shouldStoreLevel('error', 'silent')).toBe(true);
    expect(shouldStoreLevel('warn', 'silent')).toBe(false);
    expect(shouldStoreLevel('info', 'silent')).toBe(false);
  });

  it('verbose stores all', () => {
    expect(shouldStoreLevel('info', 'verbose')).toBe(true);
    expect(shouldStoreLevel('warn', 'verbose')).toBe(true);
  });

  it('normal always stores warn/error', () => {
    expect(shouldStoreLevel('warn', 'normal')).toBe(true);
    expect(shouldStoreLevel('error', 'normal')).toBe(true);
  });

  it('normal samples info', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.05);
    expect(shouldStoreLevel('info', 'normal')).toBe(true);
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    expect(shouldStoreLevel('info', 'normal')).toBe(false);
    vi.restoreAllMocks();
  });
});

describe('telemetry ring trim helpers', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it('hashQuery empty → undefined', () => {
    expect(hashQuery('')).toBeUndefined();
    expect(hashQuery(null)).toBeUndefined();
  });
});
