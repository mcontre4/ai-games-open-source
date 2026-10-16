import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, writeFile } from 'node:fs/promises';
import { bindSupabaseLoopback } from './loopback-bindings.ts';
const exec = promisify(execFile);
const network = 'ai-games-local';
try {
  await exec('docker', ['network', 'inspect', network]);
} catch {
  await exec('docker', [
    'network',
    'create',
    '-o',
    'com.docker.network.bridge.host_binding_ipv4=127.0.0.1',
    network,
  ]);
}
console.log('Starting local Supabase on a loopback-bound Docker network…');
const result = await exec(
  'pnpm',
  [
    'exec',
    'supabase',
    'start',
    '--workdir',
    'infrastructure',
    '--network-id',
    network,
    '--exclude',
    'studio,imgproxy,edge-runtime,logflare,vector,supavisor',
  ],
  { maxBuffer: 4 * 1024 * 1024, timeout: 600_000 },
);
await mkdir('work', { recursive: true });
await writeFile('work/infra-start.log', result.stdout + result.stderr, { mode: 0o600 });
await bindSupabaseLoopback();
console.log('Supabase is ready. Run pnpm setup:local to write local credentials.');
