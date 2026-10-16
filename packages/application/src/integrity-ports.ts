export type IntegrityPlatform = 'ios' | 'android';
export interface IntegrityChallenge {
  nonce: string;
  userId: string;
  purpose: 'register' | 'request';
  expiresAt: string;
}
export interface AppInstance {
  keyId: string;
  userId: string;
  publicKey: string;
  counter: number;
}
export interface IntegrityRepository {
  issue(challenge: IntegrityChallenge, now: string): Promise<void>;
  challenge(nonce: string): Promise<IntegrityChallenge | null>;
  instance(keyId: string): Promise<AppInstance | null>;
  // Consuming a challenge and advancing a counter/registering a key must be atomic.
  complete(input: {
    nonce: string;
    userId: string;
    purpose: IntegrityChallenge['purpose'];
    now: string;
    registration?: AppInstance;
    assertion?: { keyId: string; counter: number };
  }): Promise<void>;
}
export interface IntegrityVerifierPort {
  registerApple(input: {
    keyId: string;
    proof: string;
    nonce: string;
    now: string;
  }): Promise<string>;
  verifyApple(input: { instance: AppInstance; proof: string; payload: string }): Promise<number>;
  verifyAndroid(input: { proof: string; payload: string; now: string }): Promise<void>;
}
export interface AppIntegrityDependencies {
  enabled: boolean;
  repository: IntegrityRepository;
  verifier: IntegrityVerifierPort;
}
