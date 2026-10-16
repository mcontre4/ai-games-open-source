// Explicit cryptographic fixture: real assertion signatures with a test-enrolled key.
// This is never evidence of native Apple enrollment or a live Google Play verdict.
import { createHash, generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import type {
  IntegrityRepository,
  IntegrityChallenge,
  AppInstance,
} from '../packages/application/src/integrity-ports.ts';
import { invalidIntegrity } from '../packages/application/src/integrity.ts';
export const integritySettings = {
  teamId: 'TESTTEAM01',
  bundleId: 'com.aigames.creator',
  packageName: 'com.aigames.creator',
  certificateDigests: ['test-certificate'],
  allowDevelopment: false,
};
export const fixtureUser = 'b04e9262-566c-48c6-bab7-963c07953482';
export const integrityIds = {
  next: (prefix: string) => `${prefix}_${randomBytes(16).toString('hex')}`,
  token: () => randomBytes(32).toString('base64url'),
  hash: (value: string) => createHash('sha256').update(value).digest('hex'),
};
export const integrityClock = { now: () => '2026-10-11T12:00:00.000Z' };
export class MemoryIntegrityRepository implements IntegrityRepository {
  challenges = new Map<string, IntegrityChallenge>();
  instances = new Map<string, AppInstance>();
  async issue(input: IntegrityChallenge) {
    this.challenges.set(input.nonce, input);
  }
  async challenge(nonce: string) {
    return this.challenges.get(nonce) ?? null;
  }
  async instance(keyId: string) {
    return this.instances.get(keyId) ?? null;
  }
  async complete(input: Parameters<IntegrityRepository['complete']>[0]) {
    const challenge = this.challenges.get(input.nonce);
    if (
      !challenge ||
      challenge.userId !== input.userId ||
      challenge.purpose !== input.purpose ||
      Date.parse(challenge.expiresAt) <= Date.parse(input.now)
    )
      throw invalidIntegrity();
    if (input.registration) {
      if (this.instances.has(input.registration.keyId)) throw invalidIntegrity();
      this.instances.set(input.registration.keyId, input.registration);
    }
    if (input.assertion) {
      const instance = this.instances.get(input.assertion.keyId);
      if (
        !instance ||
        instance.userId !== input.userId ||
        instance.counter >= input.assertion.counter
      )
        throw invalidIntegrity();
      this.instances.set(instance.keyId, { ...instance, counter: input.assertion.counter });
    }
    this.challenges.delete(input.nonce);
  }
}
export function assertionFixture(userId = fixtureUser) {
  const keys = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const instance: AppInstance = {
    userId,
    keyId: randomBytes(32).toString('base64'),
    publicKey: keys.publicKey.export({ format: 'pem', type: 'spki' }).toString(),
    counter: 0,
  };
  return {
    instance,
    proof(
      payload: string,
      counter: number,
      appId = `${integritySettings.teamId}.${integritySettings.bundleId}`,
    ) {
      const authData = Buffer.alloc(37);
      createHash('sha256').update(appId).digest().copy(authData);
      authData.writeUInt32BE(counter, 33);
      const hash = createHash('sha256')
        .update(Buffer.concat([authData, createHash('sha256').update(payload).digest()]))
        .digest();
      const signature = sign('sha256', hash, keys.privateKey);
      // CBOR map with two text keys and byte strings, matching Apple's assertion wire format.
      return Buffer.concat([Buffer.from([0xa2,0x69]),Buffer.from('signature'),Buffer.from([0x58,signature.length]),signature,Buffer.from([0x71]),Buffer.from('authenticatorData'),Buffer.from([0x58,authData.length]),authData]).toString('base64');
    },
  };
}
