import { appScheme } from '../config/environment';
import {
  noAnalytics,
  safeAnalytics,
  type AnalyticsPort,
} from '../../../../packages/application/src/analytics.ts';
import { Asset } from 'expo-asset';
import { Platform, Share } from 'react-native';
import type {
  Game,
  GameVersion,
  GameView,
  GenerationSpeed,
  Generation,
  Json,
  Save,
} from '../../../../packages/domain/src/index.ts';
import { validateState } from '../../../../packages/domain/src/index.ts';
import type { Manifest } from '../../../../packages/contracts/src/index.ts';
import { ApiClient } from '../adapters/api';
import { LocalDatabase, type InstalledGame } from '../adapters/sqlite';
import { NativeInstaller } from '../adapters/installer';
import { supabase } from '../adapters/auth';
import fixture from '../../assets/fixture.json';
import type {
  AccountProfile,
  CreatorProfile,
  Profile,
  ProfileUpdate,
} from '../../../../packages/domain/src/profile.ts';
import { validateProfile } from '../../../../packages/domain/src/profile.ts';
import { profileCache } from '../adapters/profile-cache';
import type { CreditBalance } from '../../../../packages/domain/src/credits.ts';
export interface LibraryState {
  games: Game[];
  installed: InstalledGame[];
  jobs: Generation[];
  online: boolean;
  aiAvailable: boolean;
  profile?: AccountProfile | null;
  credits?: CreditBalance | null;
}
import { PrepareGuestLink, CompleteGuestLink } from './guest-linking';
import { guestClaimStorage } from '../adapters/guest-claim';
export class MobileController {
  private analytics: AnalyticsPort;
  constructor(
    analytics: AnalyticsPort = noAnalytics,
    private now: () => number = Date.now,
  ) {
    this.analytics = safeAnalytics(analytics);
  }
  readonly db = new LocalDatabase();
  readonly api = new ApiClient();
  private installer = new NativeInstaller(this.db);
  private syncing = false;
  account = 'guest';
  isGuest = true;
  guestLinkError: string | null = null;
  private linking: Promise<void> | null = null;
  private readonly guestApi = {
    issue: () => this.api.request<{ token: string; guestId: string }>('/guest/claim-token', 'POST'),
    claim: (token: string, accountId: string) =>
      this.api.request<{ guestId: string; gameIds: string[] }>(
        '/me/claim-guest',
        'POST',
        { token },
        accountId,
      ),
  };
  async linkGuestGames() {
    if (this.account === 'guest') return;
    if (this.linking) return this.linking;
    const account = this.account;
    this.linking = this.isGuest
      ? new PrepareGuestLink(this.guestApi, guestClaimStorage).execute(account)
      : new CompleteGuestLink(this.guestApi, guestClaimStorage, (guestId, accountId, gameIds) =>
          this.installer.transferAccount(guestId, accountId, gameIds),
        ).execute(account);
    try {
      await this.linking;
      this.guestLinkError = null;
    } catch (error) {
      this.guestLinkError =
        error instanceof Error
          ? error.message
          : 'Your guest games are waiting to be linked. Try again.';
      throw error;
    } finally {
      this.linking = null;
    }
  }
  async ensureGuestSession(ageConfirmed: boolean) {
    const { data } = await supabase.auth.getSession();
    if (!data.session) {
      if (!ageConfirmed) throw new Error('Confirm you are 16 or older before creating games.');
      const result = await supabase.auth.signInAnonymously({
        options: { data: { age_confirmed: true } },
      });
      if (result.error) throw result.error;
      this.account = result.data.user!.id;
      this.isGuest = true;
    } else {
      this.account = data.session.user.id;
      this.isGuest = data.session.user.is_anonymous === true;
    }
    await this.linkGuestGames();
  }
  email = '';
  playerName = 'Player';
  profile: AccountProfile | null = null;
  async refresh(): Promise<LibraryState> {
    const account = this.account;
    let linked = true;
    try {
      await this.linkGuestGames();
    } catch {
      linked = false;
    }
    let profile =
      this.profile?.id === account
        ? this.profile
        : account === 'guest'
          ? null
          : await profileCache.load(account);
    const installed = await this.db.installed(account);
    let games = await this.db.library(account);
    let jobs: Generation[] = [];
    let credits: CreditBalance | null = null;
    let online = false,
      aiAvailable = false;
    try {
      if (!linked) throw new Error('Guest linking is waiting to retry.');
      const health = await this.api.health();
      online = true;
      aiAvailable = health.aiAvailable;
      if (account !== 'guest') {
        [games, jobs, credits] = await Promise.all([
          this.api.request<Game[]>('/games', 'GET', undefined, account),
          this.api.request<Generation[]>('/generations', 'GET', undefined, account),
          this.api
            .request<CreditBalance>('/me/credits', 'GET', undefined, account)
            .catch(() => null),
        ]);
        await this.db.cache(account, games);
        profile = await this.api.request<AccountProfile>('/me/profile', 'GET', undefined, account);
        await profileCache.save(profile);
        if (this.account === account) {
          this.profile = profile;
          this.playerName = profile.displayName;
          await this.sync(false);
        }
      }
    } catch {
      /* Cached downloaded games remain available when the network fails. */
    }
    const fixtureGame = fixture.game as Game;
    const merged = new Map(
      [...installed.map((i) => i.game), ...games, fixtureGame].map((game) => [game.id, game]),
    );
    return {
      games: [...merged.values()],
      installed,
      jobs,
      online,
      aiAvailable,
      profile,
      credits,
    };
  }
  async playFixture() {
    const game = fixture.game as Game;
    const asset = Asset.fromModule(require('../../assets/neon-comet.zip'));
    await asset.downloadAsync();
    let bytes: Uint8Array;
    if (Platform.OS === 'web') bytes = new Uint8Array(await (await fetch(asset.uri)).arrayBuffer());
    else bytes = new Uint8Array(await (await fetch(asset.localUri!)).arrayBuffer());
    return this.installer.execute(this.account, game, bytes, fixture.publicKey, {
      gameId: game.id,
      versionId: fixture.versionId,
      checksum: fixture.checksum,
    });
  }
  async download(gameId: string, versionId: string) {
    if (gameId === fixture.game.id) return this.playFixture();
    const details = await this.details(gameId);
    const version = details.versions.find((v) => v.id === versionId);
    if (!version) throw new Error('Version not available.');
    const started = this.now();
    const bytes = await this.api.package(gameId, versionId);
    const key = process.env.EXPO_PUBLIC_PACKAGE_SIGNING_KEY;
    if (!key) throw new Error('Package verification key is not configured.');
    const installed = await this.installer.execute(this.account, details, bytes, key, {
      gameId,
      versionId,
      checksum: version.checksum,
    });
    try {
      const cloud = await this.api.request<Save | null>(`/games/${gameId}/save`);
      if (cloud) await this.db.restore(this.account, cloud);
    } catch {
      /* Downloaded games can open even when cloud save loading fails. */
    }
    this.analytics.capture('game_download_completed', this.account, {
      game_id: gameId,
      version_id: versionId,
      fixture: false,
      package_bytes: bytes.length,
      duration_ms: this.now() - started,
    });
    return installed;
  }
  async details(
    gameId: string,
  ): Promise<Game & { versions: GameVersion[]; leaderboard: { player: string; score: number }[] }> {
    try {
      return await this.api.request(`/games/${gameId}`);
    } catch (error) {
      if (gameId === fixture.game.id)
        return {
          ...fixture.game,
          versions: [
            {
              id: fixture.versionId,
              gameId,
              number: 1,
              artifactKey: '',
              sourceKey: '',
              packageBytes: fixture.bytes,
              checksum: fixture.checksum,
              createdAt: fixture.game.createdAt,
              stateSchemaVersion: 1,
            },
          ],
          leaderboard: [],
        } as Game & { versions: GameVersion[]; leaderboard: [] };
      const cached = (await this.db.installed(this.account)).find((i) => i.game.id === gameId);
      if (cached)
        return {
          ...cached.game,
          versions: [
            {
              id: cached.manifest.versionId,
              gameId,
              number: 1,
              artifactKey: '',
              sourceKey: '',
              packageBytes: cached.bytes,
              checksum: '',
              createdAt: cached.game.createdAt,
              stateSchemaVersion: cached.manifest.stateSchemaVersion,
            },
          ],
          leaderboard: [],
        };
      throw error;
    }
  }
  async create(
    prompt: string,
    orientation: 'portrait' | 'landscape',
    gameId?: string,
    view: GameView = '2d',
    ageConfirmed = false,
    speed: GenerationSpeed = 'regular',
  ) {
    await this.ensureGuestSession(ageConfirmed);
    return this.api.request<{ gameId: string; generationId: string; generation: Generation }>(
      gameId ? `/games/${gameId}/modify` : '/games',
      'POST',
      gameId ? { prompt, speed } : { prompt, orientation, view, speed },
    );
  }
  async launch(gameId: string) {
    const installed = (await this.db.installed(this.account)).find((i) => i.game.id === gameId);
    if (!installed) throw new Error('Download this game first.');
    const firstPlay = installed.lastPlayed === null;
    return { ...installed, firstPlay };
  }
  async markPlayed(account: string, installed: InstalledGame) {
    // Called only once the local game responds through the validated bridge.
    await this.db.install(account, {
      ...installed,
      lastPlayed: new Date(this.now()).toISOString(),
    });
  }
  async save(accountId: string, manifest: Manifest, state: Json) {
    validateState(state);
    await this.db.save(accountId, manifest, state);
    this.analytics.capture('game_save_local_updated', accountId, {
      game_id: manifest.gameId,
      version_id: manifest.versionId,
      schema_version: manifest.stateSchemaVersion,
      fixture: manifest.gameId === fixture.game.id,
    });
  }
  async score(accountId: string, manifest: Manifest, score: number) {
    await this.db.score(accountId, manifest, score);
    this.analytics.capture('game_score_local_updated', accountId, {
      game_id: manifest.gameId,
      version_id: manifest.versionId,
      score,
      fixture: manifest.gameId === fixture.game.id,
    });
  }
  async sync(manual = true) {
    if (this.account === 'guest' || this.syncing || (!manual && this.profile?.autoSync === false))
      return;
    this.syncing = true;
    const account = this.account;
    try {
      for (const { save, localRevision } of await this.db.pending(account)) {
        try {
          const cloud = await this.api.request<Save>(
            `/games/${save.gameId}/save`,
            'PUT',
            {
              versionId: save.versionId,
              schemaVersion: save.schemaVersion,
              baseRevision: save.revision,
              state: save.state,
            },
            account,
          );
          await this.db.acknowledge(account, cloud, localRevision);
        } catch (error) {
          if (error instanceof Error && error.message === 'REVISION_CONFLICT') {
            const cloud = await this.api.request<Save>(
              `/games/${save.gameId}/save`,
              'GET',
              undefined,
              account,
            );
            this.analytics.capture('game_save_conflict', account, {
              game_id: save.gameId,
              version_id: save.versionId,
            });
            if (cloud) await this.db.conflict(account, save, cloud, localRevision);
          } else break;
        }
      }
      for (const score of await this.db.pendingScores(account)) {
        try {
          await this.api.request(
            `/games/${score.game_id}/score`,
            'POST',
            { versionId: score.version_id, score: score.score },
            account,
          );
          await this.db.scoreAcknowledged(account, score.game_id, score.score);
        } catch {
          break;
        }
      }
    } finally {
      this.syncing = false;
    }
  }
  async share(gameId: string) {
    const invitation = await this.api.request<{ id: string; token: string }>(
      `/games/${gameId}/share`,
      'POST',
    );
    await Share.share({
      message: `Play my game: ${appScheme}://share/${invitation.token}`,
      url: `${appScheme}://share/${invitation.token}`,
    });
    return invitation;
  }
  async accept(token: string) {
    return this.api.request<Game>('/shares/accept', 'POST', { token });
  }
  async shares(gameId: string) {
    return this.api.request<{ id: string; revoked: boolean; playerIds: string[] }[]>(
      `/games/${gameId}/shares`,
    );
  }
  async revoke(shareId: string) {
    await this.api.request(`/shares/${shareId}`, 'DELETE');
  }
  async removeDownload(gameId: string) {
    const game = (await this.db.installed(this.account)).find((g) => g.game.id === gameId);
    if (game) {
      await this.installer.remove(this.account, game);
      this.analytics.capture('game_download_removed', this.account, {
        game_id: gameId,
        fixture: game.game.fixture,
      });
    }
  }
  async removeLibrary(gameId: string) {
    await this.api.request(`/library/${gameId}`, 'DELETE');
    await this.removeDownload(gameId);
  }
  async updateGameMetadata(gameId: string, title: string, description: string) {
    return this.api.request<Game>(`/games/${gameId}`, 'PATCH', { title, description });
  }
  async deleteGame(gameId: string) {
    await this.api.request(`/games/${gameId}`, 'DELETE');
    await this.removeDownload(gameId);
  }
  async report(gameId: string, detail: string) {
    await this.api.request(`/games/${gameId}/report`, 'POST', { reason: 'other', detail });
  }
  async block(creatorId: string) {
    await this.api.request('/blocks', 'POST', { creatorId });
    for (const installed of await this.db.installed(this.account))
      if (installed.game.ownerId === creatorId) await this.removeDownload(installed.game.id);
  }
  async updateProfile(input: ProfileUpdate) {
    const account = this.account;
    const profile = await this.api.request<AccountProfile>(
      '/me/profile',
      'PUT',
      validateProfile(input),
      account,
    );
    await profileCache.save(profile);
    if (this.account === account) {
      this.profile = profile;
      this.playerName = profile.displayName;
    }
    return profile;
  }
  async creatorProfile(username: string) {
    return this.api.request<{ profile: Profile; games: Game[] }>(
      `/profiles/${encodeURIComponent(username)}`,
    );
  }
  async blockedCreators() {
    return this.api.request<CreatorProfile[]>('/blocks');
  }
  async unblock(creatorId: string) {
    await this.api.request(`/blocks/${creatorId}`, 'DELETE');
  }
  async exportData() {
    const data = await this.api.request<Record<string, unknown>>('/me/export');
    await Share.share({ title: 'My AI Games data', message: JSON.stringify(data, null, 2) });
  }
  async changeCredentials(
    currentPassword: string,
    update: { email: string } | { password: string },
  ) {
    if (!currentPassword) throw new Error('Enter your current password.');
    const account = this.account;
    const signed = await supabase.auth.signInWithPassword({
      email: this.email,
      password: currentPassword,
    });
    if (signed.error) throw signed.error;
    if (signed.data.user.id !== account) throw new Error('Account changed.');
    const { error } = await supabase.auth.updateUser(update, {
      emailRedirectTo: `${appScheme}://auth`,
    });
    if (error) throw error;
  }
  async deleteAccount() {
    await this.api.request('/me', 'DELETE');
    await this.installer.purge(this.account);
    await this.db.purge(this.account);
    await profileCache.remove(this.account);
    await supabase.auth.signOut({ scope: 'local' });
    this.account = 'guest';
    this.isGuest = true;
    this.profile = null;
    this.playerName = 'Player';
  }
  async signOut() {
    await supabase.auth.signOut({ scope: 'local' });
    this.account = 'guest';
    this.isGuest = true;
    this.email = '';
    this.profile = null;
    this.playerName = 'Player';
  }
}
