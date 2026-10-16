import { randomBytes, randomUUID, createHash } from 'node:crypto';
import type { ClockPort, IdPort } from '../../application/src/ports.ts';
export class SystemClock implements ClockPort {
  now() {
    return new Date().toISOString();
  }
}
export class RandomIdentity implements IdPort {
  next(prefix: string) {
    return `${prefix}_${randomUUID().replaceAll('-', '')}`;
  }
  token() {
    return randomBytes(32).toString('base64url');
  }
  hash(value: string) {
    return createHash('sha256').update(value).digest('hex');
  }
}
