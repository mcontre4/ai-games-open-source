import { DomainError, type GenerationSpeed } from '../../../domain/src/index.ts';

/** Server-owned tier policy; never accept provider parameters from game code. */
export function codingTier(
  speed: GenerationSpeed = 'regular',
): 'priority' | 'ultrafast' | undefined {
  switch (speed) {
    case 'regular':
      return undefined;
    case 'fast':
      return 'priority';
    case 'ultra-fast':
      return 'ultrafast';
    default:
      throw new DomainError('INVALID_SPEED', 'Choose regular, fast or ultra fast.');
  }
}
