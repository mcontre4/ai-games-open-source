export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export const gameViews = ['2d', '3d', 'isometric'] as const;
export type GameView = (typeof gameViews)[number];
export const generationSpeeds = ['regular', 'fast', 'ultra-fast'] as const;
export type GenerationSpeed = (typeof generationSpeeds)[number];
export type Orientation = 'portrait' | 'landscape';
export interface GameDesign {
  premise: string;
  coreLoop: string;
  goal: string;
  decisions: string;
  progression: string;
  feedback: string;
  replay: string;
}
export interface GameSpritePlan {
  player: string;
  threat: string | null;
  reward: string | null;
  prop: string | null;
}
export interface GamePresentationPlan {
  composition: string;
  camera: string;
  hierarchy: string;
  motion: {
    idle: string;
    movement: string;
    action: string;
    success: string;
    failure: string;
  };
  acceptance: string[];
}
export interface GameArtDirection {
  theme: string;
  visualStyle: string;
  animationStyle: string;
  imagePrompt: string;
  /** Optional only for source archives created before structured game design. */
  gameplay?: GameDesign;
  /** Four independently usable illustrations in the 2D sprite sheet. */
  sprites?: GameSpritePlan;
  /** Concrete composition and motion contract; optional for legacy archives. */
  presentation?: GamePresentationPlan;
  quality: 'premium' | 'intentional-low-fi';
  pixelArt: boolean;
  typography: 'rounded' | 'serif' | 'sans' | 'mono';
  cornerRadius: number;
  palette: {
    background: string;
    surface: string;
    text: string;
    muted: string;
    accent: string;
    onAccent: string;
  };
}
export type Stage =
  | 'queued'
  | 'designing'
  | 'artwork'
  | 'coding'
  | 'building'
  | 'testing'
  | 'packaging'
  | 'ready'
  | 'failed'
  | 'cancelled';
export interface Game {
  id: string;
  ownerId: string;
  title: string;
  description: string;
  orientation: Orientation;
  /** Missing on legacy games; treated as 2D. */
  view?: GameView;
  currentVersionId: string | null;
  public: boolean;
  fixture: boolean;
  createdAt: string;
  creator?: import('./profile.ts').CreatorProfile;
}
export interface GameVersion {
  id: string;
  gameId: string;
  number: number;
  artifactKey: string;
  sourceKey: string;
  packageBytes: number;
  checksum: string;
  createdAt: string;
  stateSchemaVersion: number;
}
export interface Generation {
  /** Older clients may omit this; new requests default to regular. */
  speed?: GenerationSpeed;
  /** Private state exists for this attempt or an inherited retry. */
  progressSaved?: boolean;
  retryOf?: string | null;
  id: string;
  gameId: string;
  userId: string;
  prompt: string;
  kind: 'create' | 'modify';
  stage: Stage;
  error: string | null;
  baseVersionId: string | null;
  createdAt: string;
}
export interface Save {
  gameId: string;
  versionId: string;
  schemaVersion: number;
  revision: number;
  state: Json;
}
export interface Invitation {
  id: string;
  gameId: string;
  expiresAt: string;
  revoked: boolean;
}
export class DomainError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 400,
  ) {
    super(message);
  }
}
export function requireOwner(game: Game, userId: string): void {
  if (game.ownerId !== userId)
    throw new DomainError('FORBIDDEN', 'Only the creator can do that.', 403);
}
export function validateState(state: Json): void {
  const encoded = JSON.stringify(state);
  if (new TextEncoder().encode(encoded).byteLength > 64 * 1024)
    throw new DomainError('STATE_TOO_LARGE', 'Save data exceeds 64 KiB.');
  const visit = (value: Json, depth: number): void => {
    if (depth > 32) throw new DomainError('INVALID_STATE', 'Save data is too deeply nested.');
    if (typeof value === 'number' && !Number.isFinite(value))
      throw new DomainError('INVALID_STATE', 'Numbers must be finite.');
    if (value && typeof value === 'object') {
      for (const [key, child] of Object.entries(value)) {
        if (['__proto__', 'constructor', 'prototype'].includes(key))
          throw new DomainError('INVALID_STATE', 'Reserved state key.');
        visit(child, depth + 1);
      }
    }
  };
  visit(state, 0);
}
export function validateScore(score: number): void {
  if (!Number.isSafeInteger(score) || score < 0 || score > 1_000_000_000)
    throw new DomainError('INVALID_SCORE', 'Score is outside the allowed range.');
}
export function validateGamePrompt(prompt: string): void {
  if (
    prompt.trim().length < 12 ||
    prompt.length > 4000 ||
    /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(prompt)
  )
    throw new DomainError('INVALID_PROMPT', 'Describe your game in 12–4000 characters.');
}
export const activeStages: Stage[] = [
  'queued',
  'designing',
  'artwork',
  'coding',
  'building',
  'testing',
  'packaging',
];
