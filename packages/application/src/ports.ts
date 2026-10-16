import type { PromptAssessment } from '../../domain/src/moderation.ts';
import type { CreditBalance } from '../../domain/src/credits.ts';
export interface CreditRepository {
  balance(userId: string, now: string): Promise<CreditBalance>;
}
import type {
  Game,
  GameVersion,
  Generation,
  Invitation,
  Json,
  Save,
  Stage,
  GameArtDirection,
  Orientation,
  GameView,
} from '../../domain/src/index.ts';
import type {
  AccountProfile,
  CreatorProfile,
  Profile,
  ProfileUpdate,
} from '../../domain/src/profile.ts';
export interface ProfileRepository {
  account(userId: string): Promise<AccountProfile>;
  update(userId: string, input: ProfileUpdate): Promise<AccountProfile>;
  creator(username: string, viewerId: string): Promise<Profile>;
  blocked(userId: string): Promise<CreatorProfile[]>;
  unblock(userId: string, creatorId: string): Promise<void>;
  export(userId: string): Promise<Record<string, unknown>>;
}
export interface ClockPort {
  now(): string;
}
export interface IdPort {
  next(prefix: string): string;
  token(): string;
  hash(value: string): string;
}
export interface AuthPort {
  authenticate(token: string): Promise<{
    id: string;
    email: string;
    createdAt: string;
    ageConfirmed?: boolean;
    anonymous?: boolean;
  }>;
  deleteAccount(userId: string): Promise<void>;
}
export interface GameRepository {
  list(userId: string, ownerId?: string): Promise<Game[]>;
  accessible(gameId: string, userId: string): Promise<Game>;
  updateMetadata(gameId: string, userId: string, title: string, description: string): Promise<void>;
  versions(gameId: string): Promise<GameVersion[]>;
  version(versionId: string): Promise<GameVersion>;
  remove(gameId: string, userId: string): Promise<void>;
  removeFromLibrary(gameId: string, userId: string): Promise<void>;
  report(gameId: string, userId: string, reason: string, detail: string): Promise<void>;
  block(userId: string, creatorId: string): Promise<void>;
}
export interface GenerationRepository {
  reserve(input: {
    generation: Generation;
    game: Game | null;
    newLimit: number;
    modifyLimit: number;
    jobCap: number;
    dailyCap: number;
  }): Promise<void>;
  retry?(input: {
    userId: string;
    id: string;
    generation: Generation;
    policy: { newLimit: number; modifyLimit: number; jobCap: number; dailyCap: number };
  }): Promise<Generation>;
  get(id: string): Promise<Generation>;
  list(userId: string): Promise<Generation[]>;
  stage(id: string, stage: Stage, error?: string): Promise<void>;
  publish(
    generationId: string,
    version: GameVersion,
    title: string,
    description: string,
  ): Promise<void>;
}
export interface ProgressRepository {
  load(userId: string, gameId: string): Promise<Save | null>;
  save(
    userId: string,
    gameId: string,
    input: Omit<Save, 'gameId' | 'revision'>,
    baseRevision: number,
  ): Promise<Save>;
  score(userId: string, gameId: string, versionId: string, score: number): Promise<void>;
  leaderboard(gameId: string): Promise<{ player: string; score: number }[]>;
}
export interface SharingRepository {
  create(
    ownerId: string,
    gameId: string,
    tokenHash: string,
    id: string,
    expiresAt: string,
  ): Promise<Invitation>;
  accept(userId: string, tokenHash: string, now: string): Promise<Game>;
  list(gameId: string): Promise<(Invitation & { playerIds: string[] })[]>;
  revoke(ownerId: string, invitationId: string): Promise<void>;
}
export interface ModerationPort {
  check(
    prompt: string,
    modification: boolean,
    jobId: string,
    signal: AbortSignal,
  ): Promise<PromptAssessment>;
}
export interface QueuePort {
  start(): Promise<void>;
  dispatch(): Promise<void>;
  stop(): Promise<void>;
}
export interface StoragePort {
  put(key: string, bytes: Uint8Array): Promise<void>;
  get(key: string): Promise<Uint8Array>;
  exists(key: string): Promise<boolean>;
  removeGame?(gameId: string): Promise<void>;
}
export interface SandboxPort {
  create(
    jobId: string,
    source: Uint8Array | null,
    gateway: { url: string; token: string; model: string; checkpoints?: boolean },
    view?: GameView,
    context?: Uint8Array,
  ): Promise<Sandbox>;
}
export interface Sandbox {
  endpoint: string;
  snapshot?(): Promise<{ source: Uint8Array; context: Uint8Array }>;
  configureArtDirection?(direction: GameArtDirection): Promise<void>;
  generate(prompt: string, signal: AbortSignal): Promise<void>;
  build(signal: AbortSignal): Promise<void>;
  validate(signal: AbortSignal): Promise<{
    files: Record<string, Uint8Array>;
    visuals?: GameVisualSnapshot[];
    source: Uint8Array;
    title: string;
    description: string;
  }>;
  artwork(bytes: Uint8Array, kind?: 'background' | 'sprites'): Promise<void>;
  reuseSpriteArtwork?(direction: GameArtDirection): Promise<Uint8Array | null>;
  destroy(): Promise<void>;
}
export interface ImageGenerationPort {
  create(
    prompt: string,
    jobId: string,
    signal: AbortSignal,
    options?: {
      orientation: Orientation;
      quality: GameArtDirection['quality'];
      kind?: 'background' | 'sprites';
      pixelArt?: boolean;
      spriteFrames?: number[];
    },
  ): Promise<Uint8Array>;
}
export interface ArtDirectionPort {
  plan(
    input: {
      prompt: string;
      orientation: Orientation;
      view?: GameView;
      previousSource: Uint8Array | null;
    },
    jobId: string,
    signal: AbortSignal,
  ): Promise<GameArtDirection>;
}
export interface GatewayPort {
  register(
    jobId: string,
  ): Promise<{ url: string; token: string; model: string; checkpoints?: boolean }>;
  revoke(jobId: string): void;
  failure?(jobId: string): Error | undefined;
  checkpoint?(jobId: string, save: () => Promise<void>): void;
}
export interface PackagerPort {
  package(
    game: Game,
    versionId: string,
    files: Record<string, Uint8Array>,
  ): Promise<{ bytes: Uint8Array; checksum: string }>;
}
export interface LocalSavePort {
  load(accountId: string, gameId: string): Promise<Save | null>;
  put(accountId: string, save: Save): Promise<void>;
  pending(accountId: string): Promise<Save[]>;
  acknowledge(
    accountId: string,
    gameId: string,
    expectedLocalRevision: number,
    cloud: Save,
  ): Promise<void>;
  conflict(accountId: string, gameId: string, local: Save, cloud: Save): Promise<void>;
}
export interface CloudSavePort {
  load(gameId: string): Promise<Save | null>;
  push(save: Save, baseRevision: number): Promise<Save>;
}
export interface PlayerPort {
  playerName(): string;
  game(): { id: string; versionId: string; title: string };
}
export type { Json };

/** Private worker state; never included in playable packages or public API responses. */
export interface GenerationCheckpoint {
  moderationComplete?: boolean;
  direction?: GameArtDirection;
  artworkKey?: string;
  spritesKey?: string;
  sourceKey?: string;
  contextKey?: string;
  codingComplete?: boolean;
  diagnostic?: string;
  attempts: number;
}
export interface GenerationCheckpointPort {
  load(jobId: string): Promise<GenerationCheckpoint | null>;
  save(jobId: string, checkpoint: GenerationCheckpoint): Promise<void>;
  resumeContext?(jobId: string): Promise<string | null>;
}
export interface GenerationCallPort {
  record(jobId: string, input: unknown, output: unknown): Promise<void>;
}
export interface RetryDelayPort {
  wait(ms: number): Promise<void>;
}

/** Trusted browser captures, never credentials or agent-selected URLs. */
export interface GameVisualSnapshot {
  orientation: Orientation;
  phase: 'menu' | 'play' | 'later-play';
  bytes: Uint8Array;
}
export interface GameQualityPort {
  review(
    input: {
      request: string;
      direction: GameArtDirection;
      view: GameView;
      visuals: GameVisualSnapshot[];
    },
    jobId: string,
    signal: AbortSignal,
  ): Promise<{ approved: boolean; issues: string[] }>;
}
