import { afterEach, expect, it, vi } from 'vitest';
const fixture = vi.hoisted(() => ({
  execute: vi.fn(),
  getSession: vi.fn(),
  fetch: vi.fn(),
}));
vi.mock('../../apps/mobile/node_modules/react-native/index.js', () => ({
  Platform: { OS: 'ios' },
}));
vi.mock('../../apps/mobile/src/adapters/analytics', () => ({ captureMobile: vi.fn() }));
vi.mock('../../apps/mobile/src/adapters/auth', () => ({
  supabase: { auth: { getSession: fixture.getSession } },
}));
vi.mock('../../apps/mobile/src/config/environment', () => ({ apiUrl: 'https://api.example.com' }));
vi.mock('../../apps/mobile/src/adapters/integrity', () => ({
  clientAttestation: () => ({ execute: fixture.execute }),
  orderedAppRequest: (execute: () => Promise<unknown>) => execute(),
}));
// Keep native ambient types out of the server TypeScript program; mobile has its own typecheck.
const mobileApiModule = '../../apps/mobile/src/adapters/api.ts';
const { ApiClient } = await import(mobileApiModule);
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetAllMocks();
});
function setup(mode: string | undefined) {
  vi.stubEnv('EXPO_PUBLIC_APP_ENV', 'production');
  vi.stubEnv('EXPO_PUBLIC_APP_INTEGRITY_MODE', mode);
  fixture.getSession.mockResolvedValue({
    data: { session: { user: { id: 'user_fixture' }, access_token: 'fixture-token' } },
  });
  fixture.fetch.mockImplementation(async () => Response.json([]));
  vi.stubGlobal('fetch', fixture.fetch);
  return new ApiClient();
}
it('inactive verification calls production with the authenticated session without native proofs', async () => {
  const api = setup('disabled');
  expect(await api.request('/games')).toEqual([]);
  expect(fixture.execute).not.toHaveBeenCalled();
  expect(fixture.fetch.mock.calls[0]![1].headers.Authorization).toBe('Bearer fixture-token');
});
it.each(['required', undefined])(
  'required or missing mode fails closed when native verification fails (%s)',
  async (mode) => {
    const api = setup(mode);
    fixture.execute.mockRejectedValue(new Error('Native verification unavailable'));
    await expect(api.request('/games')).rejects.toThrow('Native verification unavailable');
    expect(fixture.fetch).not.toHaveBeenCalled();
  },
);
it('inactive verification still requires an authenticated session', async () => {
  const api = setup('disabled');
  fixture.getSession.mockResolvedValue({ data: { session: null } });
  await expect(api.request('/games')).rejects.toThrow('Sign in');
  expect(fixture.fetch).not.toHaveBeenCalled();
});
