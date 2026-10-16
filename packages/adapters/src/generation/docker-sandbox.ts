import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { z } from 'zod';
import { artDirectionSchema } from '../../../contracts/src/index.ts';
import { gameViews, type GameArtDirection, type GameView } from '../../../domain/src/index.ts';
import { unzipSync, zipSync, type Zippable } from 'fflate';
import type { Sandbox, SandboxPort } from '../../../application/src/ports.ts';
import { visualPreview } from './visual-preview.ts';
import { CodexCodingAgent } from '../ai/codex.ts';
import { analyzeGameSource } from './static-analysis.ts';
import { validateGameInBrowser } from './browser-validation.ts';
const exec = promisify(execFile);
export async function docker(args: string[], signal?: AbortSignal) {
  return (
    await exec('docker', args, { signal, timeout: 120_000, maxBuffer: 1024 * 1024 })
  ).stdout.trim();
}
async function writeSandboxFile(tag: string, path: string, bytes: Uint8Array) {
  if (
    !/^(src\/Game\.ts|public\/game\.json|public\/assets\/[a-zA-Z0-9_-]+\.(png|jpg|webp)|visuals\/(background|sprites)\.jpg)$/.test(
      path,
    ) ||
    bytes.byteLength > 10 * 1024 * 1024
  )
    throw new Error('Unsafe sandbox file.');
  // docker cp uses a daemon archive path that cannot reliably resolve this
  // read-only container's tmpfs on Docker Desktop. Write through its existing
  // unprivileged process namespace instead; no host mount or permission change.
  await new Promise<void>((resolve, reject) => {
    const child = execFile(
      'docker',
      [
        'exec',
        '-i',
        tag,
        'node',
        '-e',
        "const fs=require('node:fs');fs.mkdirSync(require('node:path').dirname(process.argv[1]),{recursive:true});fs.writeFileSync(process.argv[1],fs.readFileSync(0));",
        `/workspace/${path}`,
      ],
      { timeout: 120_000, maxBuffer: 65536 },
      (error) => (error ? reject(error) : resolve()),
    );
    child.stdin?.on('error', reject);
    child.stdin?.end(bytes);
  });
}
async function sandboxFiles(tag: string, root: 'dist' | 'public/assets', signal?: AbortSignal) {
  const { stdout } = await exec(
    'docker',
    ['exec', tag, 'node', '/opt/export-files.mjs', `/workspace/${root}`],
    { signal, timeout: 120_000, maxBuffer: 45 * 1024 * 1024 },
  );
  const files = z.record(z.string(), z.string()).parse(JSON.parse(stdout));
  return Object.fromEntries(
    Object.entries(files).map(([path, encoded]) => [
      path,
      new Uint8Array(Buffer.from(encoded, 'base64')),
    ]),
  );
}
/** Export only mutable game files and native CLI conversation records. */
export async function snapshotSandbox(tag: string) {
  if (!/^aig-gen-[a-zA-Z0-9-]+$/.test(tag)) throw new Error('Invalid sandbox identity.');
  const { stdout } = await exec('docker', ['exec', tag, 'node', '/opt/checkpoint.mjs', 'export'], {
    timeout: 120_000,
    maxBuffer: 85 * 1024 * 1024,
  });
  const result = z
    .object({ source: z.record(z.string(), z.string()), context: z.record(z.string(), z.string()) })
    .strict()
    .parse(JSON.parse(stdout));
  const archive = (files: Record<string, string>) =>
    zipSync(
      Object.fromEntries(
        Object.entries(files).map(([path, bytes]) => [
          path,
          new Uint8Array(Buffer.from(bytes, 'base64')),
        ]),
      ),
    );
  return { source: archive(result.source), context: archive(result.context) };
}
export class DockerSandbox implements SandboxPort {
  constructor(
    private image: string,
    private gatewayPort: number,
  ) {}
  async create(
    id: string,
    source: Uint8Array | null,
    gateway: { url: string; token: string; model: string; checkpoints?: boolean },
    view: GameView = '2d',
    context?: Uint8Array,
  ): Promise<Sandbox> {
    if (!gameViews.includes(view)) throw new Error('Invalid game view.');
    const starter = view === '2d' ? '/opt/starter' : '/opt/starter-3d';
    const tag = `aig-${id.replaceAll('_', '-')}`;
    const network = `${tag}-net`,
      relay = `${tag}-gateway`;
    const workspace = resolve('work/sandboxes', tag);
    await mkdir(workspace, { recursive: true });
    try {
      await docker(['network', 'create', '--internal', network]);
      await docker([
        'run',
        '-d',
        '--name',
        relay,
        '--network',
        'bridge',
        '--read-only',
        '--cap-drop=ALL',
        '--security-opt',
        'no-new-privileges',
        '--pids-limit',
        '32',
        '--memory',
        '64m',
        '--cpus',
        '.25',
        '--user',
        '1000:1000',
        '--add-host',
        'host.docker.internal:host-gateway',
        '-e',
        `UPSTREAM_PORT=${this.gatewayPort}`,
        this.image,
        'node',
        '/opt/relay.mjs',
      ]);
      await docker(['network', 'connect', '--alias', 'gateway', network, relay]);
      await docker([
        'run',
        '-d',
        '--name',
        tag,
        '--network',
        network,
        '--read-only',
        '--cap-drop=ALL',
        '--security-opt',
        'no-new-privileges',
        '--pids-limit',
        '128',
        '--memory',
        '1024m',
        '--cpus',
        '1',
        '--user',
        '1000:1000',
        '--tmpfs',
        '/workspace:rw,nosuid,nodev,size=128m,uid=1000,gid=1000',
        '--tmpfs',
        '/tmp:rw,nosuid,nodev,size=64m,uid=1000,gid=1000',
        '--tmpfs',
        '/codex:rw,nosuid,nodev,size=64m,uid=1000,gid=1000',
        '-e',
        `GENERATION_GATEWAY_URL=${gateway.url}`,
        '-e',
        `GENERATION_GRANT=${gateway.token}`,
        '-e',
        `GENERATION_MODEL=${gateway.model}`,
        '-e',
        `GENERATION_CHECKPOINTS_REQUIRED=${gateway.checkpoints ? 'true' : 'false'}`,
        '-e',
        'CODEX_HOME=/codex',
        '-e',
        `GAME_VIEW=${view}`,
        '-e',
        'HOME=/tmp',
        '-w',
        '/workspace',
        this.image,
        'sh',
        '-c',
        `cp -r ${starter}/. /workspace/ && ln -s /opt/deps/node_modules /workspace/node_modules && touch /tmp/workspace-ready && exec sleep infinity`,
      ]);
      for (let i = 0; ; i++) {
        try {
          await docker(['exec', tag, 'test', '-f', '/tmp/workspace-ready']);
          break;
        } catch {
          if (i >= 59) throw new Error('Codex sandbox startup timed out.');
          await new Promise((r) => setTimeout(r, 250));
        }
      }
      if (source) {
        const files = unzipSync(source);
        for (const [path, bytes] of Object.entries(files)) {
          if (
            !/^(src\/Game\.ts|public\/game\.json|public\/assets\/[a-zA-Z0-9_-]+\.(png|jpg|webp))$/.test(
              path,
            ) ||
            bytes.length > 10 * 1024 * 1024
          )
            throw new Error('Unsafe source archive.');
          await writeSandboxFile(tag, path, bytes);
        }
      }
      let originalDirection: unknown;
      if (source) {
        const metadata = unzipSync(source)['public/game.json'];
        if (metadata) {
          try {
            originalDirection = JSON.parse(new TextDecoder().decode(metadata)).artDirection;
          } catch {
            /* Unfinished metadata can be repaired by the resumed agent. */
          }
        }
      }
      if (!context) {
        const initialMetadata = JSON.parse(
          await docker(['exec', tag, 'cat', '/workspace/public/game.json']),
        );
        await writeSandboxFile(
          tag,
          'public/game.json',
          new TextEncoder().encode(JSON.stringify({ ...initialMetadata, view })),
        );
      }
      let baseline = await docker(['exec', tag, 'sha256sum', '/workspace/src/Game.ts']);
      if (context) {
        const files = unzipSync(context);
        await new Promise<void>((resolve, reject) => {
          const child = execFile(
            'docker',
            ['exec', '-i', tag, 'node', '/opt/checkpoint.mjs', 'import'],
            { timeout: 120_000, maxBuffer: 65536 },
            (error) => (error ? reject(error) : resolve()),
          );
          child.stdin?.on('error', reject);
          child.stdin?.end(
            JSON.stringify(
              Object.fromEntries(
                Object.entries(files).map(([path, bytes]) => [
                  path,
                  Buffer.from(bytes).toString('base64'),
                ]),
              ),
            ),
          );
        });
        const state = JSON.parse(await docker(['exec', tag, 'cat', '/codex/state.json']));
        if (state.baseline) baseline = state.baseline;
      } else {
        await docker([
          'exec',
          tag,
          'node',
          '-e',
          "require('node:fs').writeFileSync('/codex/state.json',JSON.stringify({baseline:process.argv[1]}))",
          baseline,
        ]);
      }
      const endpoint = `docker-exec://${tag}`;
      const agent = new CodexCodingAgent(tag, view);
      let expectedDirection: GameArtDirection | undefined;
      const approvedArtwork = new Map<string, Uint8Array>();
      return {
        endpoint,
        reuseSpriteArtwork: async (direction) => {
          if (view !== '2d' || !source) return null;
          const prior = artDirectionSchema.safeParse(originalDirection);
          const bytes = unzipSync(source)['public/assets/sprites.png'];
          if (
            !bytes ||
            !prior.success ||
            !prior.data.sprites ||
            prior.data.visualStyle !== direction.visualStyle ||
            prior.data.pixelArt !== direction.pixelArt ||
            prior.data.quality !== direction.quality ||
            JSON.stringify(prior.data.palette) !== JSON.stringify(direction.palette) ||
            JSON.stringify(prior.data.sprites) !== JSON.stringify(direction.sprites)
          )
            return null;
          return bytes;
        },
        snapshot: () => snapshotSandbox(tag),
        configureArtDirection: async (direction) => {
          expectedDirection = artDirectionSchema.parse(direction);
          // A checkpoint may contain unfinished/invalid metadata. Let the resumed
          // agent repair it instead of discarding it during sandbox initialization.
          if (context) return;
          const current = JSON.parse(
            await docker(['exec', tag, 'cat', '/workspace/public/game.json']),
          );
          await writeSandboxFile(
            tag,
            'public/game.json',
            new TextEncoder().encode(
              JSON.stringify({
                title: current.title,
                description: current.description,
                artDirection: expectedDirection,
                view,
              }),
            ),
          );
        },
        generate: (prompt, signal) => agent.execute(prompt, signal),
        artwork: async (bytes, kind = 'background') => {
          if (!['background', 'sprites'].includes(kind)) throw new Error('Invalid artwork kind.');
          const path = `public/assets/${kind}.png`;
          approvedArtwork.set(path, new Uint8Array(bytes));
          await writeSandboxFile(tag, path, bytes);
          await writeSandboxFile(tag, `visuals/${kind}.jpg`, await visualPreview(bytes));
        },
        build: async (signal) => {
          await docker(['exec', tag, 'node', '/opt/check-frozen.mjs'], signal);
          await docker(
            ['exec', tag, '/opt/deps/node_modules/.bin/vite', 'build', '--configLoader', 'native'],
            signal,
          );
        },
        validate: async (signal) => {
          if (
            (await docker(['exec', tag, 'sha256sum', '/workspace/src/Game.ts'], signal)) ===
            baseline
          )
            throw new Error('Agent did not change gameplay source.');
          const gameSource = await docker(['exec', tag, 'cat', '/workspace/src/Game.ts'], signal);
          analyzeGameSource(gameSource, view);
          const files = await sandboxFiles(tag, 'dist', signal);
          for (const [path, bytes] of approvedArtwork) {
            const built = files[path.replace(/^public\//, '')];
            if (!built || !Buffer.from(built).equals(Buffer.from(bytes)))
              throw new Error('Supplied game artwork was changed or omitted.');
          }
          if (view === '2d' && expectedDirection?.sprites && !files['assets/sprites.png'])
            throw new Error('Missing the approved 2D sprite artwork.');
          const metadata = z
            .object({
              title: z.string().min(3).max(100),
              description: z.string().min(12).max(1000),
              artDirection: artDirectionSchema,
              view: z.enum(gameViews).optional(),
            })
            .strict()
            .parse(JSON.parse(new TextDecoder().decode(files['game.json'])));
          if ((metadata.view ?? '2d') !== view)
            throw new Error('The game changed its approved view.');
          if (metadata.title === 'Untitled game')
            throw new Error('Missing original game metadata.');
          if (
            expectedDirection &&
            JSON.stringify(metadata.artDirection) !== JSON.stringify(expectedDirection)
          )
            throw new Error(
              'The game changed its approved art direction. Preserve the supplied palette/style metadata.',
            );
          const visuals = await validateGameInBrowser(
            files,
            join(workspace, 'screenshot.png'),
            view,
          );
          signal.throwIfAborted();
          const sourceFiles: Zippable = {
            'src/Game.ts': [new TextEncoder().encode(gameSource), { mtime: new Date(1980, 0, 1) }],
            'public/game.json': [files['game.json']!, { mtime: new Date(1980, 0, 1) }],
          };
          for (const [path, bytes] of Object.entries(
            await sandboxFiles(tag, 'public/assets', signal),
          ))
            sourceFiles[`public/assets/${path}`] = [bytes, { mtime: new Date(1980, 0, 1) }];
          return {
            files,
            visuals,
            source: zipSync(sourceFiles),
            title: metadata.title,
            description: metadata.description,
          };
        },
        destroy: async () => {
          await docker(['rm', '-f', tag]).catch(() => {});
          await docker(['rm', '-f', relay]).catch(() => {});
          await docker(['network', 'rm', network]).catch(() => {});
          await rm(workspace, { recursive: true, force: true });
        },
      };
    } catch (error) {
      await docker(['rm', '-f', tag]).catch(() => {});
      await docker(['rm', '-f', relay]).catch(() => {});
      await docker(['network', 'rm', network]).catch(() => {});
      await rm(workspace, { recursive: true, force: true });
      throw error;
    }
  }
}
