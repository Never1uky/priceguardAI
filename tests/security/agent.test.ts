import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

/**
 * Structural regression guards for the shopping agent.
 * Edge `index.ts` cannot be imported under vitest (esm.sh createClient at
 * module scope) — same approach as yookassa-webhook.test.ts.
 */

const ROOT = path.resolve(__dirname, '../..');

async function readRepo(...parts: string[]): Promise<string> {
  return fs.readFile(path.join(ROOT, ...parts), 'utf-8');
}

function sliceFunction(source: string, signature: string, nextSignature?: string): string {
  const start = source.indexOf(signature);
  expect(start, `missing ${signature}`).toBeGreaterThanOrEqual(0);
  const from = start;
  const end = nextSignature ? source.indexOf(nextSignature, from + 1) : source.length;
  expect(end, `could not bound ${signature}`).toBeGreaterThan(from);
  return source.slice(from, end);
}

describe('security/agent: analyzeCandidates never judges the uncapped SERP', () => {
  it('caps with AGENT_MAX_PRODUCTS_AFTER_FILTER before the AI loop (slice or capAgentShortlist)', async () => {
    const source = await readRepo('supabase', 'functions', '_shared', 'agent-tools.ts');
    const fn = sliceFunction(
      source,
      'export async function analyzeCandidates(',
      'export async function rankAndExplain(',
    );

    const capRe =
      /capAgentShortlist\(\s*shortlist\s*,\s*AGENT_MAX_PRODUCTS_AFTER_FILTER\s*\)|\.slice\(\s*0\s*,\s*AGENT_MAX_PRODUCTS_AFTER_FILTER\s*\)/;
    expect(fn, 'analyzeCandidates must shortlist before judging').toMatch(capRe);

    const capIdx = fn.search(capRe);
    const loopIdx = fn.search(/capped\.map\(|Promise\.all\(/);
    expect(loopIdx).toBeGreaterThan(capIdx);

    expect(fn).not.toMatch(/shortlist\.map\(/);
    expect(fn).not.toMatch(/runAgentAi[\s\S]*shortlist(?!\s*,)/);
  });
});

describe('security/agent: prompt injection fence', () => {
  it('all system prompts include «данные, не инструкции»', async () => {
    const source = await readRepo('supabase', 'functions', '_shared', 'agent-prompts.ts');

    expect(source).toMatch(/AGENT_DATA_NOT_INSTRUCTIONS/);
    expect(source).toMatch(/данные, не инструкции/);

    for (const builder of [
      'export function buildAgentParseSystem(',
      'export function buildAgentJudgeSystem(',
      'export function buildAgentRankSystem(',
    ]) {
      const fn = sliceFunction(source, builder);
      expect(fn, `${builder} must include the fence`).toMatch(/AGENT_DATA_NOT_INSTRUCTIONS/);
    }
  });
});

describe('security/agent: shopping-agent HTTP', () => {
  it('checks isAgentDailyCapped before inserting agent_searches', async () => {
    const source = await readRepo('supabase', 'functions', 'shopping-agent', 'index.ts');
    const post = sliceFunction(source, 'async function handlePost(', 'async function handleGet(');

    const capIdx = post.indexOf('isAgentDailyCapped');
    const insertIdx = post.search(/\.from\(\s*'agent_searches'\s*\)[\s\S]*?\.insert\(/);
    expect(capIdx, 'isAgentDailyCapped must be in handlePost').toBeGreaterThanOrEqual(0);
    expect(insertIdx, 'handlePost must insert agent_searches').toBeGreaterThanOrEqual(0);
    expect(capIdx).toBeLessThan(insertIdx);
  });

  it('GET filters by id AND user_id (owner), not id alone', async () => {
    const source = await readRepo('supabase', 'functions', 'shopping-agent', 'index.ts');
    expect(source).toMatch(/requireAuthUser\(req,\s*true\)/);

    const get = sliceFunction(source, 'async function handleGet(');
    expect(get).toMatch(/\.eq\(\s*'id'\s*,\s*searchId\s*\)/);
    expect(get).toMatch(/\.eq\(\s*'user_id'\s*,\s*userId\s*\)/);

    const idEq = get.search(/\.eq\(\s*'id'\s*,\s*searchId\s*\)/);
    const userEq = get.search(/\.eq\(\s*'user_id'\s*,\s*userId\s*\)/);
    expect(Math.abs(userEq - idEq)).toBeLessThan(120);
    expect(get).toMatch(/maybeSingle\(/);
  });
});
