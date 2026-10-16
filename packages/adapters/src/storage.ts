import { mkdir, readFile, writeFile, rename, stat, rm } from 'node:fs/promises';
import { resolve, dirname, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { StoragePort } from '../../application/src/ports.ts';
export class LocalStorage implements StoragePort {
  constructor(private root: string) {}
  private path(key: string) {
    if (!/^[a-zA-Z0-9_/-]+\.(zip|png|json)$/.test(key) || key.split('/').includes('..'))
      throw new Error('Unsafe storage key.');
    const path = resolve(this.root, key);
    if (!path.startsWith(resolve(this.root) + sep)) throw new Error('Storage escape.');
    return path;
  }
  async put(key: string, bytes: Uint8Array) {
    const path = this.path(key);
    await mkdir(dirname(path), { recursive: true });
    try {
      await stat(path);
      throw new Error('Artifacts are immutable.');
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
    }
    const temp = `${path}.${randomUUID()}.tmp`;
    await writeFile(temp, bytes, { flag: 'wx', mode: 0o600 });
    await rename(temp, path);
  }
  async get(key: string) {
    return new Uint8Array(await readFile(this.path(key)));
  }
  async removeGame(gameId: string) {
    if (!/^game_[a-zA-Z0-9]+$/.test(gameId)) throw new Error('Invalid game ID.');
    await rm(resolve(this.root, gameId), { recursive: true, force: true });
  }
  async exists(key: string) {
    try {
      await stat(this.path(key));
      return true;
    } catch {
      return false;
    }
  }
}
