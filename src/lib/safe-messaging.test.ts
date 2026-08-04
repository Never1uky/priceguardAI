import { describe, expect, it } from 'vitest';
import { isReceivingEndError } from '@/lib/extension-context';

describe('isReceivingEndError', () => {
  it('detects chrome receiving end message', () => {
    expect(
      isReceivingEndError(new Error('Could not establish connection. Receiving end does not exist.')),
    ).toBe(true);
    expect(isReceivingEndError(new Error('network failed'))).toBe(false);
  });
});
