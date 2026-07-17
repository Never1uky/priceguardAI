import { describe, expect, it } from 'vitest';
import {
  ApiError,
  formatApiErrorForUser,
  parseHttpApiError,
  parseNetworkApiError,
} from '@/lib/api/api-errors';

describe('api-errors', () => {
  it('maps 401 to invalid key message', () => {
    const err = parseHttpApiError(
      'Grok',
      401,
      JSON.stringify({ error: { message: 'Invalid API Key' } }),
    );
    expect(err.code).toBe('unauthorized');
    expect(err.userMessage).toContain('Неверный API-ключ');
    expect(err.retryable).toBe(false);
  });

  it('maps 429 to rate limit', () => {
    const err = parseHttpApiError('GPT', 429, '{"error":{"message":"Rate limit"}}');
    expect(err.code).toBe('rate_limit');
    expect(err.retryable).toBe(true);
    expect(err.userMessage).toContain('Слишком много запросов');
  });

  it('maps insufficient quota', () => {
    const err = parseHttpApiError(
      'OpenAI',
      402,
      '{"error":{"message":"Insufficient quota"}}',
    );
    expect(err.code).toBe('insufficient_quota');
    expect(err.userMessage).toContain('баланс');
  });

  it('formats network errors', () => {
    const err = parseNetworkApiError('Grok', new TypeError('Failed to fetch'));
    expect(err.code).toBe('network');
    expect(formatApiErrorForUser(err)).toContain('интернет');
  });

  it('formatApiErrorForUser handles ApiError', () => {
    const err = new ApiError({
      code: 'server_error',
      userMessage: 'Grok: Временная ошибка сервера (503).',
      retryable: true,
    });
    expect(formatApiErrorForUser(err)).toBe('Grok: Временная ошибка сервера (503).');
  });
});
