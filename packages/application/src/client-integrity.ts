import { integrityPayload } from './integrity.ts';
import type { IdPort } from './ports.ts';

export interface DeviceIntegrityPort {
  platform: 'ios' | 'android' | 'unsupported';
  supported(): boolean | Promise<boolean>;
  invalidKey(error: unknown): boolean;
  generateKey(): Promise<string>;
  attestKey(keyId: string, nonce: string): Promise<string>;
  assertion(keyId: string, payload: string): Promise<string>;
  androidProof(payload: string): Promise<string>;
}
export interface AppKeyStoragePort {
  load(userId: string): Promise<string | null>;
  save(userId: string, keyId: string): Promise<void>;
  remove(userId: string): Promise<void>;
}
export interface IntegrityTransportPort {
  challenge(token: string, purpose: 'register' | 'request'): Promise<{ nonce: string }>;
  register(token: string, input: { nonce: string; keyId: string; proof: string }): Promise<void>;
}
export class AttestClientRequest {
  constructor(
    private device: DeviceIntegrityPort,
    private storage: AppKeyStoragePort,
    private transport: IntegrityTransportPort,
    private ids: Pick<IdPort, 'hash'>,
  ) {}
  async execute(input: {
    userId: string;
    token: string;
    method: string;
    path: string;
    body?: unknown;
  }): Promise<Record<string, string>> {
    if (this.device.platform === 'unsupported' || !(await this.device.supported()))
      throw new Error('This device cannot verify the app. Use a supported iOS or Android device.');
    let keyId: string | undefined;
    if (this.device.platform === 'ios') {
      keyId = (await this.storage.load(input.userId)) ?? undefined;
      if (!keyId) {
        keyId = await this.device.generateKey();
        const { nonce } = await this.transport.challenge(input.token, 'register');
        const proof = await this.device.attestKey(keyId, nonce);
        await this.transport.register(input.token, { nonce, keyId, proof });
        await this.storage.save(input.userId, keyId);
      }
    }
    const { nonce } = await this.transport.challenge(input.token, 'request');
    const payload = integrityPayload({ ...input, nonce, sessionHash: this.ids.hash(input.token) });
    let proof: string;
    try {
      proof =
        this.device.platform === 'ios'
          ? await this.device.assertion(keyId!, payload)
          : await this.device.androidProof(payload);
    } catch (error) {
      // SecureStore can survive reinstall while the device's App Attest key does not.
      // The next request enrolls a fresh verified key; the current request stays denied.
      if (this.device.platform === 'ios' && this.device.invalidKey(error))
        await this.storage.remove(input.userId);
      throw error;
    }
    return {
      'X-App-Integrity-Nonce': nonce,
      'X-App-Integrity-Platform': this.device.platform,
      'X-App-Integrity-Proof': proof,
      ...(keyId ? { 'X-App-Integrity-Key': keyId } : {}),
    };
  }
}
