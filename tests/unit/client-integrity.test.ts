import { it, expect, vi } from 'vitest';
import {
  AttestClientRequest,
  type DeviceIntegrityPort,
} from '../../packages/application/src/client-integrity.ts';
import { integrityPayload } from '../../packages/application/src/integrity.ts';
import { integrityIds, fixtureUser } from '../integrity-fixture.ts';
it('registers a separate iOS key per account and signs the complete request (explicit device fixture)', async () => {
  const stored = new Map<string, string>();
  let generated = 0;
  const device: DeviceIntegrityPort = {
    platform: 'ios',
    supported: () => true,
    invalidKey: () => false,
    generateKey: async () => `key-${++generated}`,
    attestKey: async () => 'explicit-enrollment-fixture',
    assertion: vi.fn(async () => 'explicit-assertion-fixture'),
    androidProof: vi.fn(),
  };
  const transport = {
    challenge: vi.fn(async () => ({ nonce: 'fixture-nonce' })),
    register: vi.fn(async () => {}),
  };
  const usecase = new AttestClientRequest(
    device,
    {
      load: async (id) => stored.get(id) ?? null,
      save: async (id, key) => {
        stored.set(id, key);
      },
      remove: async (id) => {
        stored.delete(id);
      },
    },
    transport,
    integrityIds,
  );
  const input = {
    userId: fixtureUser,
    token: 'fixture-session',
    method: 'POST',
    path: '/games',
    body: { prompt: 'Create a forest puzzle' },
  };
  const first = await usecase.execute(input);
  expect(first['X-App-Integrity-Key']).toBe('key-1');
  expect(device.assertion).toHaveBeenCalledWith(
    'key-1',
    integrityPayload({
      ...input,
      nonce: 'fixture-nonce',
      sessionHash: integrityIds.hash(input.token),
    }),
  );
  await usecase.execute(input);
  expect(transport.register).toHaveBeenCalledTimes(1);
  await usecase.execute({ ...input, userId: 'other-account' });
  expect(transport.register).toHaveBeenCalledTimes(2);
});
it('does not silently downgrade unsupported devices', async () => {
  const device = { platform: 'unsupported', supported: () => false } as DeviceIntegrityPort;
  const transport = { challenge: vi.fn(), register: vi.fn() };
  const usecase = new AttestClientRequest(
    device,
    { load: vi.fn(), save: vi.fn(), remove: vi.fn() },
    transport,
    integrityIds,
  );
  await expect(
    usecase.execute({ userId: fixtureUser, token: 'fixture', method: 'GET', path: '/games' }),
  ).rejects.toThrow('supported iOS or Android');
  expect(transport.challenge).not.toHaveBeenCalled();
});
it('discards a device-invalid cached Apple key and requires fresh verified enrollment on retry', async () => {
  let stored: string | null = 'key-from-before-reinstall';
  const missingKey = new Error('Explicit fixture key no longer exists');
  const device: DeviceIntegrityPort = {
    platform: 'ios',
    supported: () => true,
    invalidKey: (error) => error === missingKey,
    generateKey: async () => 'fresh-key',
    attestKey: async () => 'explicit-enrollment-fixture',
    assertion: async (key) => {
      if (key === 'key-from-before-reinstall') throw missingKey;
      return 'explicit-assertion-fixture';
    },
    androidProof: vi.fn(),
  };
  const register = vi.fn(async () => {});
  const usecase = new AttestClientRequest(
    device,
    {
      load: async () => stored,
      save: async (_, key) => {
        stored = key;
      },
      remove: async () => {
        stored = null;
      },
    },
    { challenge: async () => ({ nonce: 'fixture-nonce' }), register },
    integrityIds,
  );
  const input = { userId: fixtureUser, token: 'fixture-session', method: 'GET', path: '/games' };
  await expect(usecase.execute(input)).rejects.toThrow('no longer exists');
  expect(stored).toBeNull();
  expect(register).not.toHaveBeenCalled();
  expect((await usecase.execute(input))['X-App-Integrity-Key']).toBe('fresh-key');
  expect(register).toHaveBeenCalledOnce();
});
