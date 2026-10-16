import {
  DomainError,
  validateGamePrompt,
  requireOwner,
  validateScore,
  validateState,
  type Game,
  type GameView,
  gameViews,
  generationSpeeds,
  type GenerationSpeed,
  type Generation,
  type Json,
} from '../../domain/src/index.ts';
import type {
  ClockPort,
  GameRepository,
  GenerationRepository,
  IdPort,
  ProgressRepository,
  SharingRepository,
} from './ports.ts';
export interface GenerationPolicy {
  available: boolean;
  newLimit: number;
  modifyLimit: number;
  jobCap: number;
  dailyCap: number;
}
export class CreateGame {
  constructor(
    private games: GameRepository,
    private generations: GenerationRepository,
    private ids: IdPort,
    private clock: ClockPort,
    private policy: GenerationPolicy,
  ) {}
  async execute(
    userId: string,
    input: {
      prompt: string;
      orientation: 'portrait' | 'landscape';
      view?: GameView;
      speed?: GenerationSpeed;
      gameId?: string;
    },
  ) {
    if (!this.policy.available)
      throw new DomainError(
        'AI_UNAVAILABLE',
        'AI creation needs an OpenRouter key on the server. You can still play downloaded games.',
        503,
      );
    validateGamePrompt(input.prompt);
    if (input.speed !== undefined && !generationSpeeds.includes(input.speed))
      throw new DomainError('INVALID_SPEED', 'Choose regular, fast or ultra fast.');
    if (input.view !== undefined && !gameViews.includes(input.view))
      throw new DomainError('INVALID_VIEW', 'Choose 2D, 3D or isometric.');
    if (input.gameId) requireOwner(await this.games.accessible(input.gameId, userId), userId);
    const existing = input.gameId ? await this.games.accessible(input.gameId, userId) : null;
    const game: Game = existing ?? {
      id: this.ids.next('game'),
      ownerId: userId,
      title: 'Your new game',
      description: input.prompt.slice(0, 1000),
      orientation: input.orientation,
      view: input.view ?? '2d',
      currentVersionId: null,
      public: false,
      fixture: false,
      createdAt: this.clock.now(),
    };
    const generation: Generation = {
      id: this.ids.next('gen'),
      gameId: game.id,
      userId,
      prompt: input.prompt,
      speed: input.speed ?? 'regular',
      kind: existing ? 'modify' : 'create',
      stage: 'queued',
      error: null,
      baseVersionId: existing?.currentVersionId ?? null,
      createdAt: this.clock.now(),
    };
    await this.generations.reserve({
      generation,
      game: existing ? null : game,
      newLimit: this.policy.newLimit,
      modifyLimit: this.policy.modifyLimit,
      jobCap: this.policy.jobCap,
      dailyCap: this.policy.dailyCap,
    });
    return { gameId: game.id, generationId: generation.id, generation };
  }
}
export class ListUserGames {
  constructor(private games: GameRepository) {}
  execute(userId: string) {
    return this.games.list(userId);
  }
}
export class GetGame {
  constructor(
    private games: GameRepository,
    private progress: ProgressRepository,
  ) {}
  async execute(userId: string, id: string) {
    const game = await this.games.accessible(id, userId);
    return {
      ...game,
      versions: await this.games.versions(id),
      leaderboard: await this.progress.leaderboard(id),
    };
  }
}
export class DownloadGame {
  constructor(private games: GameRepository) {}
  async execute(userId: string, gameId: string, versionId: string) {
    await this.games.accessible(gameId, userId);
    const v = await this.games.version(versionId);
    if (v.gameId !== gameId) throw new DomainError('NOT_FOUND', 'Version not found.', 404);
    return v;
  }
}
export class SaveGameProgress {
  constructor(
    private games: GameRepository,
    private progress: ProgressRepository,
  ) {}
  async execute(
    userId: string,
    gameId: string,
    input: { versionId: string; schemaVersion: number; state: Json; baseRevision: number },
  ) {
    await this.games.accessible(gameId, userId);
    const version = await this.games.version(input.versionId);
    if (version.gameId !== gameId || version.stateSchemaVersion !== input.schemaVersion)
      throw new DomainError(
        'INCOMPATIBLE_SAVE',
        'Save schema does not match the game version.',
        409,
      );
    validateState(input.state);
    return this.progress.save(userId, gameId, input, input.baseRevision);
  }
}
export class LoadGameProgress {
  constructor(
    private games: GameRepository,
    private progress: ProgressRepository,
  ) {}
  async execute(userId: string, gameId: string) {
    await this.games.accessible(gameId, userId);
    return this.progress.load(userId, gameId);
  }
}
export class SubmitGameScore {
  constructor(
    private games: GameRepository,
    private progress: ProgressRepository,
  ) {}
  async execute(userId: string, gameId: string, input: { versionId: string; score: number }) {
    await this.games.accessible(gameId, userId);
    validateScore(input.score);
    if ((await this.games.version(input.versionId)).gameId !== gameId)
      throw new DomainError('NOT_FOUND', 'Version not found.', 404);
    await this.progress.score(userId, gameId, input.versionId, input.score);
  }
}
export class ShareGame {
  constructor(
    private games: GameRepository,
    private shares: SharingRepository,
    private ids: IdPort,
    private clock: ClockPort,
  ) {}
  async execute(userId: string, id: string) {
    requireOwner(await this.games.accessible(id, userId), userId);
    const token = this.ids.token();
    const invitation = await this.shares.create(
      userId,
      id,
      this.ids.hash(token),
      this.ids.next('share'),
      new Date(Date.parse(this.clock.now()) + 7 * 86400_000).toISOString(),
    );
    return { ...invitation, token };
  }
}
export class AcceptGameShare {
  constructor(
    private shares: SharingRepository,
    private ids: IdPort,
    private clock: ClockPort,
  ) {}
  execute(userId: string, token: string) {
    return this.shares.accept(userId, this.ids.hash(token), this.clock.now());
  }
}
export class RevokeGameShare {
  constructor(private shares: SharingRepository) {}
  execute(userId: string, id: string) {
    return this.shares.revoke(userId, id);
  }
}
export class DeleteGame {
  constructor(private games: GameRepository) {}
  async execute(userId: string, id: string) {
    requireOwner(await this.games.accessible(id, userId), userId);
    await this.games.remove(id, userId);
  }
}
export class CancelGeneration {
  constructor(private generations: GenerationRepository) {}
  async execute(userId: string, id: string) {
    const job = await this.generations.get(id);
    if (job.userId !== userId) throw new DomainError('NOT_FOUND', 'Generation not found.', 404);
    if (job.stage === 'ready')
      throw new DomainError('ALREADY_COMPLETE', 'This game is already ready.', 409);
    await this.generations.stage(id, 'cancelled');
  }
}

export class UpdateGameMetadata {
  constructor(private games: GameRepository) {}
  async execute(userId: string, id: string, input: { title: string; description: string }) {
    requireOwner(await this.games.accessible(id, userId), userId);
    const title = input.title.trim();
    const description = input.description.trim();
    if (!title || title.length > 100 || !description || description.length > 1000)
      throw new DomainError(
        'INVALID_METADATA',
        'Use a title of 1–100 characters and a description of 1–1000 characters.',
      );
    await this.games.updateMetadata(id, userId, title, description);
    return this.games.accessible(id, userId);
  }
}

export class RetryGeneration {
  constructor(
    private games: GameRepository,
    private generations: GenerationRepository,
    private ids: IdPort,
    private clock: ClockPort,
    private policy: GenerationPolicy,
  ) {}
  async execute(userId: string, id: string) {
    if (!this.policy.available)
      throw new DomainError('AI_UNAVAILABLE', 'AI creation is unavailable.', 503);
    const previous = await this.generations.get(id);
    if (previous.userId !== userId)
      throw new DomainError('NOT_FOUND', 'Generation not found.', 404);
    requireOwner(await this.games.accessible(previous.gameId, userId), userId);
    if (!this.generations.retry)
      throw new DomainError('AI_UNAVAILABLE', 'Resume is unavailable.', 503);
    const generation = await this.generations.retry({
      userId,
      id,
      policy: this.policy,
      generation: {
        ...previous,
        id: this.ids.next('gen'),
        retryOf: id,
        stage: 'queued',
        error: null,
        createdAt: this.clock.now(),
      },
    });
    return { gameId: generation.gameId, generationId: generation.id, generation };
  }
}
