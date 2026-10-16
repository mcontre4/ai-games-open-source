import cbor from 'cbor';
import { createHash, X509Certificate } from 'node:crypto';
import { verifyAttestation, verifyAssertion } from 'node-app-attest';
import { GoogleAuth } from 'google-auth-library';
import { z } from 'zod';
import type { IntegrityVerifierPort } from '../../application/src/integrity-ports.ts';
import { invalidIntegrity } from '../../application/src/integrity.ts';
import { DomainError } from '../../domain/src/index.ts';

const androidVerdict = z.object({
  requestDetails: z.object({
    requestPackageName: z.string(),
    requestHash: z.string(),
    timestampMillis: z.string().regex(/^\d+$/),
  }),
  appIntegrity: z.object({
    appRecognitionVerdict: z.string(),
    packageName: z.string(),
    certificateSha256Digest: z.array(z.string()),
  }),
  deviceIntegrity: z.object({ deviceRecognitionVerdict: z.array(z.string()) }),
  accountDetails: z.object({ appLicensingVerdict: z.string() }),
});

export interface PlayIntegrityDecoderPort {
  decode(token: string): Promise<unknown>;
}
export class GooglePlayIntegrityDecoder implements PlayIntegrityDecoderPort {
  private auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/playintegrity'] });
  constructor(private packageName: string) {}
  async decode(token: string) {
    try {
      const client = await this.auth.getClient();
      const response = await client.request<{ tokenPayloadExternal: unknown }>({
        url: `https://playintegrity.googleapis.com/v1/${this.packageName}:decodeIntegrityToken`,
        method: 'POST',
        data: { integrity_token: token },
        timeout: 10_000,
      });
      return response.data.tokenPayloadExternal;
    } catch {
      // Never propagate provider errors containing tokens or service-account details.
      throw new DomainError(
        'APP_INTEGRITY_UNAVAILABLE',
        'App verification is temporarily unavailable. Please try again.',
        503,
      );
    }
  }
}
export class PlatformIntegrityVerifier implements IntegrityVerifierPort {
  constructor(
    private settings: {
      teamId: string;
      bundleId: string;
      packageName: string;
      certificateDigests: string[];
      allowDevelopment: boolean;
    },
    private decoder: PlayIntegrityDecoderPort,
  ) {}
  async registerApple(input: Parameters<IntegrityVerifierPort['registerApple']>[0]) {
    if (!this.settings.teamId)
      throw new DomainError(
        'APP_INTEGRITY_UNAVAILABLE',
        'Apple app verification is not configured.',
        503,
      );
    try {
      const bytes = Buffer.from(input.proof, 'base64');
      const decoded = cbor.decodeAllSync(bytes);
      if (
        decoded.length !== 1 ||
        !Array.isArray(decoded[0]?.attStmt?.x5c) ||
        decoded[0].attStmt.x5c.length !== 2
      )
        throw invalidIntegrity();
      for (const certificate of decoded[0].attStmt.x5c) {
        const x509 = new X509Certificate(certificate);
        if (
          Date.parse(x509.validFrom) > Date.parse(input.now) ||
          Date.parse(x509.validTo) <= Date.parse(input.now)
        )
          throw invalidIntegrity();
      }
      const result = verifyAttestation({
        attestation: Buffer.from(input.proof, 'base64'),
        challenge: input.nonce,
        keyId: input.keyId,
        teamIdentifier: this.settings.teamId,
        bundleIdentifier: this.settings.bundleId,
        allowDevelopmentEnvironment: this.settings.allowDevelopment,
      });
      if (typeof result.publicKey !== 'string') throw invalidIntegrity();
      return result.publicKey;
    } catch {
      throw invalidIntegrity();
    }
  }
  async verifyApple(input: Parameters<IntegrityVerifierPort['verifyApple']>[0]) {
    if (!this.settings.teamId)
      throw new DomainError(
        'APP_INTEGRITY_UNAVAILABLE',
        'Apple app verification is not configured.',
        503,
      );
    try {
      const result = verifyAssertion({
        assertion: Buffer.from(input.proof, 'base64'),
        payload: input.payload,
        publicKey: input.instance.publicKey,
        signCount: input.instance.counter,
        teamIdentifier: this.settings.teamId,
        bundleIdentifier: this.settings.bundleId,
      });
      if (
        typeof result.signCount !== 'number' ||
        !Number.isSafeInteger(result.signCount) ||
        result.signCount <= input.instance.counter
      )
        throw invalidIntegrity();
      return result.signCount;
    } catch {
      throw invalidIntegrity();
    }
  }
  async verifyAndroid(input: Parameters<IntegrityVerifierPort['verifyAndroid']>[0]) {
    if (!this.settings.certificateDigests.length)
      throw new DomainError(
        'APP_INTEGRITY_UNAVAILABLE',
        'Android app verification is not configured.',
        503,
      );
    const parsed = androidVerdict.safeParse(await this.decoder.decode(input.proof));
    if (!parsed.success) throw invalidIntegrity();
    const verdict = parsed.data;
    const timestamp = Number(verdict?.requestDetails?.timestampMillis);
    const elapsed = Date.parse(input.now) - timestamp;
    if (
      !verdict ||
      verdict.requestDetails?.requestPackageName !== this.settings.packageName ||
      verdict.requestDetails.requestHash !==
        createHash('sha256').update(input.payload).digest('base64url') ||
      !Number.isFinite(timestamp) ||
      elapsed < -30_000 ||
      elapsed > 120_000 ||
      verdict.appIntegrity?.appRecognitionVerdict !== 'PLAY_RECOGNIZED' ||
      verdict.appIntegrity.packageName !== this.settings.packageName ||
      !verdict.appIntegrity.certificateSha256Digest?.some((digest) =>
        this.settings.certificateDigests.includes(digest),
      ) ||
      !verdict.deviceIntegrity?.deviceRecognitionVerdict?.includes('MEETS_DEVICE_INTEGRITY') ||
      verdict.accountDetails?.appLicensingVerdict !== 'LICENSED'
    )
      throw invalidIntegrity();
  }
}
