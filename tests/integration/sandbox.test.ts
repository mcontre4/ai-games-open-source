import { it, expect } from 'vitest';
import { DockerSandbox, docker } from '../../packages/adapters/src/generation/docker-sandbox.ts';
import { ControlledGateway } from '../../packages/adapters/src/ai/gateway.ts';
import {
  OpenRouterClient,
  InferenceBudget,
  type CodingModel,
} from '../../packages/adapters/src/ai/openrouter.ts';
import type { Database } from '../../packages/adapters/src/postgres/db.ts';
import { watercolorDirection } from '../art-direction-fixture.ts';
import sharp from 'sharp';
import { readFile } from 'node:fs/promises';
import { zipSync, strToU8, unzipSync } from 'fflate';
it('runs the real Codex CLI in a restricted Docker sandbox without model credentials', async () => {
  const id = 'gen_isolationtest';
  const tag = 'aig-gen-isolationtest';
  const box = await new DockerSandbox(
    process.env.SANDBOX_IMAGE || 'ai-games-sandbox:1',
    4101,
  ).create(id, null, {
    url: 'http://gateway:4101/v1',
    token: 'temporary-test-grant',
    model: 'test-model',
  });
  try {
    const inspect = JSON.parse(await docker(['inspect', tag]))[0];
    expect(inspect.Config.User).toBe('1000:1000');
    expect(inspect.HostConfig.ReadonlyRootfs).toBe(true);
    expect(inspect.HostConfig.CapDrop).toContain('ALL');
    expect(inspect.HostConfig.Memory).toBe(1024 * 1024 * 1024);
    expect(inspect.HostConfig.Binds).toBeNull();
    expect(inspect.Config.Env.join(' ')).not.toMatch(/SUPABASE|DATABASE_URL|OPENROUTER_API_KEY/);
    const network = JSON.parse(await docker(['network', 'inspect', `${tag}-net`]))[0];
    expect(network.Internal).toBe(true);
    expect(await docker(['exec', tag, 'cat', '/workspace/index.html'])).not.toMatch(
      /NEON COMET|hovercraft|THE MIDNIGHT RUN/,
    );
    expect(await docker(['exec', tag, 'ls', '/workspace/public/assets'])).toBe('');
    await box.configureArtDirection!(watercolorDirection);
    expect(
      JSON.parse(await docker(['exec', tag, 'cat', '/workspace/public/game.json'])).artDirection,
    ).toEqual(watercolorDirection);
    const asset = await sharp({
      create: { width: 32, height: 32, channels: 3, background: '#c4a778' },
    })
      .png()
      .toBuffer();
    await box.artwork(asset);
    const exported = JSON.parse(
      await docker(['exec', tag, 'node', '/opt/export-files.mjs', '/workspace/public/assets']),
    );
    expect(Buffer.from(exported['background.png'], 'base64')).toEqual(asset);
    await box.build(AbortSignal.timeout(20_000));
    expect(await docker(['exec', tag, 'codex', '--version'])).toContain('codex-cli 0.162.1');
    for (const [name, path] of [
      ['read', '/codex/config.toml'],
      ['write', 'package.json'],
      ['edit', 'src/sdk.ts'],
      ['inspect_art', '../private/key'],
    ]) {
      const denied = await docker([
        'exec',
        tag,
        'node',
        '-e',
        "const {spawnSync}=require('node:child_process');process.stdout.write(spawnSync('node',['/opt/game-files.mjs'],{input:process.argv[1]+'\\n',encoding:'utf8'}).stdout)",
        JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: { name, arguments: { path, content: 'forbidden' } },
        }),
      ]);
      expect(JSON.parse(denied).result.isError).toBe(true);
    }
    const beforeEdit = await docker(['exec', tag, 'cat', '/workspace/src/Game.ts']);
    const edit = async (oldText: string, newText: string) =>
      JSON.parse(
        await docker([
          'exec',
          tag,
          'node',
          '-e',
          "const {spawnSync}=require('node:child_process');process.stdout.write(spawnSync('node',['/opt/game-files.mjs'],{input:process.argv[1]+'\\n',encoding:'utf8'}).stdout)",
          JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'tools/call',
            params: { name: 'edit', arguments: { path: 'src/Game.ts', oldText, newText } },
          }),
        ]),
      ).result;
    expect(
      (await edit('Create an original game here', 'Exact scoped edit fixture')).isError,
    ).toBeUndefined();
    expect(await docker(['exec', tag, 'cat', '/workspace/src/Game.ts'])).toBe(
      beforeEdit.replace('Create an original game here', 'Exact scoped edit fixture'),
    );
    for (const [oldText, newText] of [
      ['missing span', 'x'],
      ['\n', 'x'],
      ['', 'x'],
      ['Exact scoped edit fixture', 'x'.repeat(100001)],
    ]) {
      expect((await edit(oldText!, newText!)).isError).toBe(true);
      expect(await docker(['exec', tag, 'cat', '/workspace/src/Game.ts'])).toBe(
        beforeEdit.replace('Create an original game here', 'Exact scoped edit fixture'),
      );
    }
    expect(
      (await edit('Exact scoped edit fixture', 'Create an original game here')).isError,
    ).toBeUndefined();
    expect(await docker(['exec', tag, 'cat', '/workspace/src/Game.ts'])).toBe(beforeEdit);
    expect(
      await docker([
        'exec',
        tag,
        'node',
        '-e',
        "fetch('https://example.com',{signal:AbortSignal.timeout(1500)}).then(()=>process.stdout.write('ESCAPED')).catch(()=>process.stdout.write('BLOCKED'))",
      ]),
    ).toBe('BLOCKED');
    await expect(docker(['exec', tag, 'sh', '-c', 'touch /opt/forbidden'])).rejects.toThrow();
    await expect(box.validate(AbortSignal.timeout(5000))).rejects.toThrow('did not change');
  } finally {
    await box.destroy();
  }
  await expect(docker(['inspect', tag])).rejects.toThrow();
}, 90_000);

it.each(['3d', 'isometric'] as const)(
  'builds and validates actual %s geometry in the frozen Docker starter (explicit fixture)',
  async (view) => {
    const id = `gen_three_${view}`;
    const tag = `aig-${id.replaceAll('_', '-')}`;
    const source = (await readFile('tests/fixtures/three-game.ts', 'utf8'))
      .replace('../../packages/game-template/src/sdk', './sdk')
      .replace('../../infrastructure/sandbox/three-runtime', './runtime');
    const box = await new DockerSandbox(
      process.env.SANDBOX_IMAGE || 'ai-games-sandbox:1',
      4101,
    ).create(
      id,
      null,
      {
        url: 'http://gateway:4101/v1',
        token: 'temporary-test-grant',
        model: 'test-model',
      },
      view,
    );
    try {
      await box.configureArtDirection!(watercolorDirection);
      await box.artwork(await readFile('packages/game-template/public/assets/background.png'));
      const runtime = await docker([
        'exec',
        tag,
        'node',
        '-e',
        "const {spawnSync}=require('node:child_process');process.stdout.write(spawnSync('node',['/opt/game-files.mjs'],{input:process.argv[1]+'\\n',encoding:'utf8'}).stdout)",
        JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: { name: 'read', arguments: { path: 'src/runtime.ts' } },
        }),
      ]);
      expect(JSON.parse(runtime).result.content[0].text).toContain('ThreeGameContext');
      const metadata = {
        title: `Explicit ${view} fixture`,
        description: 'Deterministic offline runtime fixture, not AI generation.',
        artDirection: watercolorDirection,
        view,
      };
      for (const [path, content] of [
        ['src/Game.ts', source],
        ['public/game.json', JSON.stringify(metadata)],
      ]) {
        const output = await docker([
          'exec',
          tag,
          'node',
          '-e',
          "const {spawnSync}=require('node:child_process');process.stdout.write(spawnSync('node',['/opt/game-files.mjs'],{input:process.argv[1]+'\\n',encoding:'utf8'}).stdout)",
          JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'tools/call',
            params: { name: 'write', arguments: { path, content } },
          }),
        ]);
        expect(JSON.parse(output).result.isError).not.toBe(true);
      }
      await box.build(AbortSignal.timeout(30000));
      const result = await box.validate(AbortSignal.timeout(30000));
      expect(result.title).toBe(metadata.title);
      expect(new TextDecoder().decode(result.files['game.js'])).toContain('WebGLRenderer');
      // Check the actual trusted runtime cannot be modified by the agent.
      const denied = await docker([
        'exec',
        tag,
        'node',
        '-e',
        "const {spawnSync}=require('node:child_process');process.stdout.write(spawnSync('node',['/opt/game-files.mjs'],{input:process.argv[1]+'\\n',encoding:'utf8'}).stdout)",
        JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: { name: 'write', arguments: { path: 'src/runtime.ts', content: 'tampered' } },
        }),
      ]);
      expect(JSON.parse(denied).result.isError).toBe(true);
      await docker([
        'exec',
        tag,
        'node',
        '-e',
        "require('node:fs').appendFileSync('/workspace/src/runtime.ts','\\n// test tamper')",
      ]);
      await expect(box.build(AbortSignal.timeout(5000))).rejects.toThrow(
        'Protected starter file changed',
      );
    } finally {
      await box.destroy();
    }
    // Restoring a 3D source archive uses the same frozen host and retains the camera view.
    const restored = await new DockerSandbox(
      process.env.SANDBOX_IMAGE || 'ai-games-sandbox:1',
      4101,
    ).create(
      `${id}_restore`,
      zipSync({
        'src/Game.ts': strToU8(source),
        'public/game.json': strToU8(
          JSON.stringify({
            title: 'Restored 3D game',
            description: 'Explicit source restore fixture',
            artDirection: watercolorDirection,
            view,
          }),
        ),
      }),
      {
        url: 'http://gateway:4101/v1',
        token: 'temporary-test-grant',
        model: 'test-model',
      },
      view,
    );
    try {
      const metadata = JSON.parse(
        await docker(['exec', `${tag}-restore`, 'cat', '/workspace/public/game.json']),
      );
      expect(metadata.view).toBe(view);
      expect(metadata.title).toBe('Restored 3D game');
    } finally {
      await restored.destroy();
    }
  },
  90000,
);

it('supports real Codex CLI prompt transport through the controlled SSE gateway with an explicit test completion', async () => {
  let calls = 0;
  const recorded: unknown[] = [];
  const snapshots: { source: Uint8Array; context: Uint8Array }[] = [];
  class TestCompletionClient extends OpenRouterClient {
    override async responses(_jobId: string, _model: CodingModel, body: Record<string, unknown>) {
      if (Array.isArray(body.tools) && body.tools.length === 0) {
        expect(body.tool_choice).toBe('none');
        expect(JSON.stringify(body.input)).toContain('compaction-transport-proof');
        return {
          id: 'resp_compaction',
          status: 'completed',
          output: [
            {
              id: 'summary',
              type: 'message',
              role: 'assistant',
              status: 'completed',
              content: [
                {
                  type: 'output_text',
                  text: 'Saved artwork and implementation; next repair the score display.',
                  annotations: [],
                },
              ],
            },
          ],
          usage: { input_tokens: 20, output_tokens: 12 },
        };
      }
      if (JSON.stringify(body.input).includes('resume-transport-proof')) {
        expect(JSON.stringify(body.input)).toContain('Codex transport test');
        expect(JSON.stringify(body.input)).toContain('test_tool_2');
      }
      if (JSON.stringify(body.input).includes('abort-transport-test'))
        await new Promise((resolve) => setTimeout(resolve, 3000));
      calls++;
      if (calls > 1) {
        const messages = body.input as { type: string; output: string }[];
        expect(
          JSON.stringify(
            messages.filter((message) => message.type === 'function_call_output').at(-1)?.output,
          ),
        ).not.toMatch(/requires approval|failed|Error|error/);
      }
      if (calls === 4) expect(JSON.stringify(body.input)).toContain('data:image/jpeg;base64,');
      if (calls <= 4) {
        const name = `mcp__game_files__${calls === 1 ? 'read' : calls === 2 ? 'write' : calls === 3 ? 'inspect_art' : 'edit'}`;
        const tools = body.tools as { name: string }[];
        expect(tools.some((t) => t.name === name)).toBe(true);
        const args =
          calls === 1
            ? { path: 'public/game.json' }
            : calls === 3
              ? { path: 'background' }
              : calls === 4
                ? {
                    path: 'public/game.json',
                    oldText: 'Explicit tool-call transport fixture only.',
                    newText: 'Scoped edit transport fixture only.',
                  }
                : {
                    path: 'public/game.json',
                    content: JSON.stringify({
                      title: 'Codex transport test',
                      description: 'Explicit tool-call transport fixture only.',
                    }),
                  };
        return {
          id: 'resp_test_tool',
          status: 'completed',
          output: [
            {
              id: `fc_test_${calls}`,
              type: 'function_call',
              call_id: `test_tool_${calls}`,
              name,
              arguments: JSON.stringify(args),
              status: 'completed',
            },
          ],
          usage: { input_tokens: 20, output_tokens: 12 },
        };
      }
      return {
        id: 'resp_test',
        status: 'completed',
        output: [
          {
            id: 'msg_test',
            type: 'message',
            role: 'assistant',
            status: 'completed',
            content: [
              {
                type: 'output_text',
                text: 'This is an explicit transport fixture. No game was generated.',
                annotations: [],
              },
            ],
          },
        ],
        usage: { input_tokens: 20, output_tokens: 12 },
      };
    }
  }
  const model: CodingModel = {
    id: 'openai/gpt-6.1-sol',
    architecture: { output_modalities: ['text'] },
    supported_parameters: ['tools'],
    pricing: { prompt: '0.000001', completion: '0.000001' },
  };
  const gateway = new ControlledGateway(
    new TestCompletionClient('test-only', new InferenceBudget({} as Database)),
    model,
    4411,
    60_000,
    {
      record: async (...args) => {
        recorded.push(args);
      },
    },
  );
  await gateway.start();
  const id = 'gen_sdktransport';
  let box: Awaited<ReturnType<DockerSandbox['create']>> | undefined;
  try {
    box = await new DockerSandbox(process.env.SANDBOX_IMAGE || 'ai-games-sandbox:1', 4411).create(
      id,
      null,
      await gateway.register(id),
    );
    await box.artwork(
      await sharp({ create: { width: 32, height: 32, channels: 3, background: '#c4a778' } })
        .png()
        .toBuffer(),
    );
    gateway.checkpoint(id, async () => {
      snapshots.push(await box!.snapshot!());
    });
    await box.generate(
      'Create an arcade game. This integration test checks transport only.',
      AbortSignal.timeout(50_000),
    );
    expect(calls).toBeGreaterThanOrEqual(4);
    expect(
      JSON.parse(
        await docker(['exec', 'aig-gen-sdktransport', 'cat', '/workspace/public/game.json']),
      ).description,
    ).toBe('Scoped edit transport fixture only.');
    expect(
      JSON.parse(
        await docker(['exec', 'aig-gen-sdktransport', 'cat', '/workspace/public/game.json']),
      ).title,
    ).toBe('Codex transport test');
    const denied = await fetch('http://127.0.0.1:4411/v1/responses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    expect(denied.status).toBe(401);
    await expect(box.generate('abort-transport-test', AbortSignal.timeout(1500))).rejects.toThrow();
    expect(
      await docker([
        'exec',
        'aig-gen-sdktransport',
        'node',
        '-e',
        "const fs=require('node:fs');const active=fs.readdirSync('/proc').filter(p=>/^\\d+$/.test(p)).filter(p=>{try{const a=fs.readFileSync('/proc/'+p+'/cmdline','utf8').split('\\0');return a.some((v,i)=>v.endsWith('/codex')&&a[i+1]==='exec')}catch{return false}});process.stdout.write(String(active.length))",
      ]),
    ).toBe('0');
    expect(
      snapshots.some((saved) =>
        new TextDecoder()
          .decode(unzipSync(saved.source)['public/game.json'])
          .includes('Codex transport test'),
      ),
    ).toBe(true);
    expect(recorded.length).toBeGreaterThan(0);
    expect(JSON.stringify(recorded)).not.toContain('Authorization');
    const checkpoint = await box.snapshot!();
    const sessions = unzipSync(checkpoint.context);
    expect(Object.keys(sessions).some((path) => path.startsWith('sessions/'))).toBe(true);
    expect(JSON.parse(new TextDecoder().decode(sessions['state.json']!)).threadId).toMatch(
      /^[a-f0-9-]{36}$/,
    );
    expect(new TextDecoder().decode(sessions['events.jsonl']!)).toContain('thread.started');
    await box.destroy();
    gateway.revoke(id);
    const resumedId = 'gen_sdktransport_resume';
    box = await new DockerSandbox(process.env.SANDBOX_IMAGE || 'ai-games-sandbox:1', 4411).create(
      resumedId,
      checkpoint.source,
      await gateway.register(resumedId),
      '2d',
      checkpoint.context,
    );
    expect(
      JSON.parse(
        await docker(['exec', 'aig-gen-sdktransport-resume', 'cat', '/workspace/public/game.json']),
      ).title,
    ).toBe('Codex transport test');
    gateway.checkpoint(resumedId, async () => {
      snapshots.push(await box!.snapshot!());
    });
    await box.generate(
      'resume-transport-proof: continue the saved conversation.',
      AbortSignal.timeout(30_000),
    );
    const summaryGrant = await gateway.register(resumedId);
    const summary = await fetch('http://127.0.0.1:4411/v1/responses', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${summaryGrant.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        tools: [],
        stream: true,
        input: [
          {
            role: 'user',
            content: [
              {
                type: 'input_text',
                text: 'compaction-transport-proof: summarize the saved implementation.',
              },
            ],
          },
        ],
      }),
    });
    expect(summary.status).toBe(200);
    const summaryEvents = await summary.text();
    expect(summaryEvents).toContain('response.completed');
    expect(summaryEvents).toContain('next repair the score display');
    expect(summaryEvents).not.toContain('response.function_call_arguments');
    gateway.revoke(resumedId);
  } finally {
    await box?.destroy();
    gateway.revoke(id);
    await gateway.stop();
  }
}, 90_000);
