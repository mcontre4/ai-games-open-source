import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex } from '@noble/hashes/utils';
import {
  AttestClientRequest,
  type DeviceIntegrityPort,
  type IntegrityTransportPort,
} from '../../../../packages/application/src/client-integrity';

const digest = (value: string) => sha256(new TextEncoder().encode(value));
// Load native verification only when needed. Older development binaries can still
// use the explicit loopback bypass until rebuilt; required mode fails closed.
const appIntegrity = () => import('@expo/app-integrity');
export const sessionHash = (value: string) => bytesToHex(digest(value));
export const deviceIntegrity: DeviceIntegrityPort = {
  platform: Platform.OS === 'ios' || Platform.OS === 'android' ? Platform.OS : 'unsupported',
  supported: async () => {
    if (Platform.OS !== 'ios' && Platform.OS !== 'android') return false;
    try {
      const module = await appIntegrity();
      return Platform.OS === 'android' || module.isSupported;
    } catch {
      return false;
    }
  },
  invalidKey: (error) =>
    !!error &&
    typeof error === 'object' &&
    'code' in error &&
    error.code === 'ERR_APP_INTEGRITY_INVALID_KEY',
  generateKey: async () => (await appIntegrity()).generateKeyAsync(),
  attestKey: async (keyId, nonce) => (await appIntegrity()).attestKeyAsync(keyId, nonce),
  assertion: async (keyId, payload) =>
    (await appIntegrity()).generateAssertionAsync(keyId, payload),
  androidProof: async (payload) => {
    const project = process.env.EXPO_PUBLIC_PLAY_INTEGRITY_PROJECT_NUMBER;
    if (!project) throw new Error('Android app verification is not configured.');
    if (!androidPrepared) {
      await (await appIntegrity()).prepareIntegrityTokenProviderAsync(project);
      androidPrepared = true;
    }
    const hash = (
      await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, payload, {
        encoding: Crypto.CryptoEncoding.BASE64,
      })
    )
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    try {
      return await (await appIntegrity()).requestIntegrityCheckAsync(hash);
    } catch (error) {
      if (
        error &&
        typeof error === 'object' &&
        'code' in error &&
        error.code === 'ERR_APP_INTEGRITY_PROVIDER_INVALID'
      )
        androidPrepared = false;
      throw error;
    }
  },
};
let androidPrepared = false;
export function clientAttestation(transport: IntegrityTransportPort) {
  return new AttestClientRequest(
    deviceIntegrity,
    {
      load: (userId) => SecureStore.getItemAsync(`app-attest.${userId}`),
      save: (userId, keyId) => SecureStore.setItemAsync(`app-attest.${userId}`, keyId),
      remove: (userId) => SecureStore.deleteItemAsync(`app-attest.${userId}`),
    },
    transport,
    { hash: sessionHash },
  );
}

// Apple counters must reach the server in order across concurrent polling/sync/download calls.
let pending: Promise<unknown> = Promise.resolve();
export async function orderedAppRequest<T>(operation: () => Promise<T>): Promise<T> {
  const result = pending.then(operation, operation);
  pending = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}
