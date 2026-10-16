import { DomainError } from './index.ts';

export const promptIssues = [
  'sexual_content',
  'child_exploitation',
  'extreme_violence',
  'hate_harassment',
  'self_harm',
  'illegal_activity',
  'payments',
  'external_services',
  'security_abuse',
  'not_a_game',
] as const;
export type PromptIssue = (typeof promptIssues)[number];
export type PromptAssessment = Record<PromptIssue, number>;

const messages: Record<PromptIssue, string> = {
  sexual_content: 'Remove pornography or explicitly sexual content.',
  child_exploitation: 'Sexual content involving minors or child exploitation is not allowed.',
  extreme_violence:
    'Remove graphic gore, torture, or extreme violence. Ordinary game combat is allowed.',
  hate_harassment: 'Remove racism, hateful content, threats, or targeted harassment.',
  self_harm: 'Remove content encouraging suicide, self-harm, or dangerous real-world challenges.',
  illegal_activity: 'Remove instructions for real-world crime, exploitation, or illegal activity.',
  payments:
    'Games cannot charge players, collect payment details, or offer real-money gambling. Use fictional game currency.',
  external_services:
    'Games must stay inside this app. Remove external services, links, APIs, or network calls.',
  security_abuse:
    'Remove requests to steal data, access secrets, run malware, or bypass app restrictions.',
  not_a_game: 'Describe a playable game or a change to an existing game.',
};

export function requireSafePrompt(assessment: PromptAssessment): void {
  if (
    promptIssues.some(
      (issue) =>
        !Number.isFinite(assessment[issue]) || assessment[issue] < 0 || assessment[issue] > 1,
    )
  )
    throw new DomainError(
      'MODERATION_UNAVAILABLE',
      'We could not validate this prompt right now. Please try again shortly.',
      503,
    );
  const denied = promptIssues.filter((issue) => assessment[issue] >= 0.7);
  if (denied.length)
    throw new DomainError('UNSAFE_PROMPT', denied.map((issue) => messages[issue]).join(' '));
  if (promptIssues.some((issue) => assessment[issue] >= 0.3))
    throw new DomainError(
      'PROMPT_UNCLEAR',
      'We could not confidently validate this idea. Clarify the gameplay and remove unsafe content, payments, or external connections.',
    );
}
