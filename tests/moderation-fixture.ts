import type { ModerationPort } from '../packages/application/src/ports.ts';
import { promptIssues, type PromptAssessment } from '../packages/domain/src/moderation.ts';

// Explicit deterministic fixture. This never calls or substitutes for live Jev.
export function safePromptAssessment(): PromptAssessment {
  return Object.fromEntries(promptIssues.map((issue) => [issue, 0.01])) as PromptAssessment;
}
export const fixtureModeration: ModerationPort = { check: async () => safePromptAssessment() };
