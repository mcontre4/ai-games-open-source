import { afterEach, describe, expect, it, vi } from 'vitest';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const docker = vi.hoisted(() => ({ exec: vi.fn() }));
vi.mock('node:child_process', () => ({ execFileSync: docker.exec }));
import { bindSupabaseLoopback } from '../../scripts/loopback-bindings.ts';

afterEach(() => docker.exec.mockReset());

describe('Docker loopback binding API compatibility', () => {
  it.each(['1.47', '1.51', '1.52'])(
    'inspects existing loopback bindings using the daemon API %s',
    async (version) => {
      const root = await mkdtemp(join(tmpdir(), 'aig-docker-'));
      const socket = join(root, 'docker.sock');
      const requests: string[] = [];
      const server = createServer((request, response) => {
        requests.push(`${request.method} ${request.url}`);
        response.setHeader('Content-Type', 'application/json');
        if (request.url !== `/v${version}/containers/supabase_db_infrastructure/json`) {
          response.writeHead(400);
          response.end(JSON.stringify({ message: 'Client API version is not supported.' }));
          return;
        }
        response.end(
          JSON.stringify({
            Id: 'explicit-daemon-fixture',
            NetworkSettings: { Ports: { '5432/tcp': [{ HostIp: '127.0.0.1' }] } },
          }),
        );
      });
      docker.exec.mockImplementation((_command: string, args: string[]) => {
        if (args[0] === 'context')
          return JSON.stringify([{ Endpoints: { docker: { Host: `unix://${socket}` } } }]);
        if (args[0] === 'version') return `${version}\n`;
        if (args[0] === 'ps') return 'supabase_db_infrastructure\n';
        throw new Error('Unexpected Docker command.');
      });
      await new Promise<void>((resolve) => server.listen(socket, resolve));
      try {
        await bindSupabaseLoopback();
        expect(requests).toEqual([`GET /v${version}/containers/supabase_db_infrastructure/json`]);
      } finally {
        await new Promise<void>((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        );
        await rm(root, { recursive: true, force: true });
      }
    },
  );

  it('rejects an invalid daemon version before inspecting or changing containers', async () => {
    docker.exec.mockImplementation((_command: string, args: string[]) =>
      args[0] === 'context'
        ? JSON.stringify([{ Endpoints: { docker: { Host: 'unix:///unused-fixture.sock' } } }])
        : 'not-a-version\n',
    );
    await expect(bindSupabaseLoopback()).rejects.toThrow('Invalid Docker daemon API version.');
    expect(docker.exec.mock.calls.some(([, args]) => args[0] === 'ps')).toBe(false);
  });
});
