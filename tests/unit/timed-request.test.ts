import { afterEach, expect, it, vi } from 'vitest';
import { timedRequest } from '../../apps/mobile/src/adapters/timed-request.ts';
afterEach(() => vi.useRealTimers());
it('aborts slow requests using the AbortController available on native', async () => {
  vi.useFakeTimers();
  const fetcher: typeof fetch = async (_url, init) =>
    new Promise((_resolve, reject) => {
      init!.signal!.addEventListener('abort', () => reject(new Error('Aborted')));
    });
  const pending = timedRequest('https://test.invalid', {}, 1000, (r) => r.json(), fetcher);
  const rejected = expect(pending).rejects.toThrow('Aborted');
  await vi.advanceTimersByTimeAsync(1000);
  await rejected;
  expect(vi.getTimerCount()).toBe(0);
});
it('clears its timeout after reading a successful response', async () => {
  vi.useFakeTimers();
  const result = await timedRequest(
    'https://test.invalid',
    {},
    1000,
    (r) => r.json(),
    async () => Response.json({ ok: true }),
  );
  expect(result).toEqual({ ok: true });
  expect(vi.getTimerCount()).toBe(0);
});
