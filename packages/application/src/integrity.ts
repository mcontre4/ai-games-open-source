import { DomainError } from '../../domain/src/index.ts';
import type { ClockPort, IdPort } from './ports.ts';
import type {
  IntegrityRepository,
  IntegrityVerifierPort,
  IntegrityPlatform,
} from './integrity-ports.ts';

// Both clients and server use this serialization; object key order cannot change the proof.
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, item]) => [key, canonical(item)]),
    );
  return value;
}
export function integrityPayload(input: {
  nonce: string;
  userId: string;
  sessionHash: string;
  method: string;
  path: string;
  body?: unknown;
}): string {
  return JSON.stringify([
    1,
    input.nonce,
    input.userId,
    input.sessionHash,
    input.method.toUpperCase(),
    input.path,
    canonical(input.body ?? null),
  ]);
}
export function invalidIntegrity(): DomainError {
  return new DomainError(
    'APP_INTEGRITY_REQUIRED',
    'This request needs verification from the official app. Please try again.',
    403,
  );
}
async function challenge(
  repository: IntegrityRepository,
  nonce: string,
  userId: string,
  purpose: 'register' | 'request',
  now: string,
) {
  const found = await repository.challenge(nonce);
  if (
    !found ||
    found.userId !== userId ||
    found.purpose !== purpose ||
    Date.parse(found.expiresAt) <= Date.parse(now)
  )
    throw invalidIntegrity();
  return found;
}
export class IssueIntegrityChallenge {
  constructor(
    private repository: IntegrityRepository,
    private ids: IdPort,
    private clock: ClockPort,
  ) {}
  async execute(userId: string, purpose: 'register' | 'request') {
    const now = this.clock.now();
    const result = {
      nonce: this.ids.token(),
      userId,
      purpose,
      expiresAt: new Date(Date.parse(now) + 120_000).toISOString(),
    };
    await this.repository.issue(result, now);
    return { nonce: result.nonce, expiresAt: result.expiresAt };
  }
}
export class RegisterAppInstance {
  constructor(
    private repository: IntegrityRepository,
    private verifier: IntegrityVerifierPort,
    private clock: ClockPort,
  ) {}
  async execute(userId: string, input: { nonce: string; keyId: string; proof: string }) {
    const now = this.clock.now();
    await challenge(this.repository, input.nonce, userId, 'register', now);
    const publicKey = await this.verifier.registerApple({ ...input, now });
    await this.repository.complete({
      nonce: input.nonce,
      userId,
      purpose: 'register',
      now: this.clock.now(),
      registration: { keyId: input.keyId, userId, publicKey, counter: 0 },
    });
  }
}
export class VerifyAppRequest {
  constructor(
    private repository: IntegrityRepository,
    private verifier: IntegrityVerifierPort,
    private ids: IdPort,
    private clock: ClockPort,
  ) {}
  async execute(
    userId: string,
    input: {
      nonce: string;
      platform: IntegrityPlatform;
      proof: string;
      keyId?: string;
      token: string;
      method: string;
      path: string;
      body?: unknown;
    },
  ) {
    const now = this.clock.now();
    await challenge(this.repository, input.nonce, userId, 'request', now);
    const payload = integrityPayload({ ...input, userId, sessionHash: this.ids.hash(input.token) });
    let assertion: { keyId: string; counter: number } | undefined;
    if (input.platform === 'ios') {
      if (!input.keyId) throw invalidIntegrity();
      const instance = await this.repository.instance(input.keyId);
      if (!instance || instance.userId !== userId) throw invalidIntegrity();
      const counter = await this.verifier.verifyApple({ instance, proof: input.proof, payload });
      assertion = { keyId: instance.keyId, counter };
    } else await this.verifier.verifyAndroid({ proof: input.proof, payload, now });
    await this.repository.complete({
      nonce: input.nonce,
      userId,
      purpose: 'request',
      now: this.clock.now(),
      assertion,
    });
  }
}
