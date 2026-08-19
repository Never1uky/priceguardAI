import { describe, expect, it } from 'vitest';
import {
  applyRemoteMatchRulePack,
  getActiveCompiledRules,
  getActiveRulePackMeta,
  getBundledMatchRulePack,
  resetMatchRulesCache,
  validateMatchRulePack,
} from '@/lib/match-rules';

describe('match-rules remote overlay', () => {
  it('fails closed on invalid payload and keeps bundled', () => {
    const result = applyRemoteMatchRulePack({ bad: true }, { enableRemoteRulePack: true });
    expect(result.applied).toBe(false);
    expect(result.source).toBe('bundled');
    expect(result.reason).toBe('invalid_payload');
    expect(getActiveRulePackMeta().source).toBe('bundled');
  });

  it('rejects older remote version', () => {
    const base = getBundledMatchRulePack();
    const payload = { ...base, rulesVersion: '0.0.1' };
    const validated = validateMatchRulePack(payload);
    expect(validated.ok).toBe(false);
    expect(validated.reason).toBe('invalid_version');
  });

  it('applies valid remote pack and exposes telemetry meta', () => {
    const base = getBundledMatchRulePack();
    const payload = {
      ...base,
      rulesVersion: '9.0.0',
      roleLexicon: base.roleLexicon.slice(0, 1),
      hostFamilies: base.hostFamilies.slice(0, 1),
      entityHints: base.entityHints.slice(0, 1),
      marketingStrip: base.marketingStrip.slice(0, 1),
      roleRelations: base.roleRelations.slice(0, 1),
    };
    const result = applyRemoteMatchRulePack(payload, { enableRemoteRulePack: true });
    expect(result.applied).toBe(true);
    expect(result.source).toBe('remote');
    expect(result.reason).toBe('remote_applied');
    const compiled = getActiveCompiledRules();
    expect(compiled.rulesVersion).toBe('9.0.0');
    expect(compiled.roleLexicon).toHaveLength(1);
    const meta = getActiveRulePackMeta();
    expect(meta.source).toBe('remote');
    expect(meta.reason).toBe('remote_applied');
  });

  it('keeps bundled defaults when remote flag is disabled', () => {
    resetMatchRulesCache();
    const base = getBundledMatchRulePack();
    const result = applyRemoteMatchRulePack({ ...base, rulesVersion: '10.0.0' }, { enableRemoteRulePack: false });
    expect(result.applied).toBe(false);
    expect(result.reason).toBe('remote_disabled');
    expect(getActiveCompiledRules().rulesVersion).toBe(base.rulesVersion);
  });
});
