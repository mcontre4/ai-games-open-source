import { describe, expect, it } from 'vitest';
import { promptIssues, requireSafePrompt } from '../../packages/domain/src/moderation.ts';
import { safePromptAssessment } from '../moderation-fixture.ts';

describe('game prompt policy over typed evidence (explicit fixtures)', () => {
  it('allows a confidently safe assessment', () =>
    expect(() => requireSafePrompt(safePromptAssessment())).not.toThrow());
  it.each([NaN, Infinity, -1, 2])(
    'fails closed when an adapter supplies an invalid probability %s',
    (payments) => {
      expect(() => requireSafePrompt({ ...safePromptAssessment(), payments })).toThrow(
        'could not validate',
      );
    },
  );
  it.each(promptIssues)('rejects %s with a fixed explanation', (issue) => {
    const assessment = { ...safePromptAssessment(), [issue]: 0.99 };
    expect(() => requireSafePrompt(assessment)).toThrow();
  });
  it('reports multiple violations without including user or model prose', () => {
    expect(() =>
      requireSafePrompt({ ...safePromptAssessment(), payments: 0.99, external_services: 0.99 }),
    ).toThrow('Games cannot charge players');
    expect(() =>
      requireSafePrompt({ ...safePromptAssessment(), payments: 0.99, external_services: 0.99 }),
    ).toThrow('Remove external services');
  });
  it('blocks uncertain evidence and defines the threshold boundaries', () => {
    expect(() => requireSafePrompt({ ...safePromptAssessment(), extreme_violence: 0.7 })).toThrow(
      'Ordinary game combat is allowed',
    );
    expect(() => requireSafePrompt({ ...safePromptAssessment(), payments: 0.3 })).toThrow(
      'Clarify the gameplay',
    );
    expect(() => requireSafePrompt({ ...safePromptAssessment(), payments: 0.299 })).not.toThrow();
  });
});
