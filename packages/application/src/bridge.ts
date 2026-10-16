import { bridgeSchema, requiredCapability, type Manifest } from '../../contracts/src/index.ts';
import { DomainError, validateState, type Json, type Save } from '../../domain/src/index.ts';
export interface BridgeContext {
  accountId: string;
  manifest: Manifest;
  playerName: string;
}
export interface BridgePersistence {
  load(accountId: string, gameId: string): Promise<Save | null>;
  save(accountId: string, manifest: Manifest, state: Json): Promise<void>;
  score(accountId: string, manifest: Manifest, score: number): Promise<void>;
}
export class HandleGameMessage {
  private recent = new Set<string>();
  private windowStart = 0;
  private count = 0;
  constructor(
    private persistence: BridgePersistence,
    private context: BridgeContext,
    private now: () => number,
  ) {}
  async execute(
    raw: string,
  ): Promise<{ protocol: 1; id: string; ok: boolean; value?: unknown; error?: string }> {
    if (new TextEncoder().encode(raw).byteLength > 70 * 1024)
      throw new DomainError('INVALID_BRIDGE', 'Message too large.');
    const request = bridgeSchema.parse(JSON.parse(raw));
    if (this.recent.has(request.id))
      throw new DomainError('INVALID_BRIDGE', 'Duplicate request ID.');
    const now = this.now();
    if (now - this.windowStart > 1000) {
      this.windowStart = now;
      this.count = 0;
    }
    if (++this.count > 30) throw new DomainError('BRIDGE_RATE_LIMIT', 'Too many game requests.');
    this.recent.add(request.id);
    if (this.recent.size > 256) this.recent.delete(this.recent.values().next().value!);
    if (!this.context.manifest.capabilities.includes(requiredCapability[request.type]))
      return { protocol: 1, id: request.id, ok: false, error: 'Capability denied.' };
    const { accountId, manifest } = this.context;
    try {
      let value: unknown = null;
      switch (request.type) {
        case 'loadState': {
          const save = await this.persistence.load(accountId, manifest.gameId);
          value = save?.schemaVersion === manifest.stateSchemaVersion ? save.state : null;
          break;
        }
        case 'saveState':
          validateState(request.state);
          await this.persistence.save(accountId, manifest, request.state);
          break;
        case 'submitScore':
          await this.persistence.score(accountId, manifest, request.score);
          break;
        case 'getPlayer':
          value = { name: this.context.playerName };
          break;
        case 'getGameInfo':
          value = { id: manifest.gameId, versionId: manifest.versionId, title: manifest.title };
          break;
      }
      return { protocol: 1, id: request.id, ok: true, value };
    } catch {
      return {
        protocol: 1,
        id: request.id,
        ok: false,
        error: 'The game request could not be saved.',
      };
    }
  }
}
