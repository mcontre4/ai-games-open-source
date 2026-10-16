import { spawn, type ChildProcess } from 'node:child_process';
import { appEnvironment } from '../packages/config/src/environment.ts';
import { loadEnvironment } from './environment.ts';

const environment = appEnvironment(process.argv[2]);
const target = process.argv[3];
const args = process.argv.slice(4);
const mobileCommands: Record<string, string[]> = {
  mobile: ['start', '--dev-client', '--clear'],
  ios: ['run:ios'],
  android: ['run:android'],
  export: ['export'],
};
if (
  !target ||
  ![
    'all',
    'server',
    'api',
    'worker',
    'migrate',
    'seed',
    'live',
    'moderation',
    ...Object.keys(mobileCommands),
  ].includes(target)
)
  throw new Error(
    'Select all, server, api, worker, mobile, ios, android, export, migrate, seed, live or moderation.',
  );
if (environment === 'production' && ['all', 'seed', 'live', 'moderation'].includes(target))
  throw new Error(
    'Fixtures and automated generation checks only run in development. Run production API/worker on your server with server, api or worker.',
  );
const selected =
  target === 'all'
    ? ['api', 'worker', 'mobile']
    : target === 'server'
      ? ['api', 'worker']
      : [target];
const prepared = selected.map((name) => ({
  name,
  env: loadEnvironment(environment, name in mobileCommands ? 'mobile' : 'server'),
}));
const children: ChildProcess[] = [];
let stopping = false;
function terminate(child: ChildProcess, signal: NodeJS.Signals) {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
  try {
    if (process.platform === 'win32') child.kill(signal);
    else process.kill(-child.pid, signal);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
  }
}
function stop(code: number) {
  if (stopping) return;
  stopping = true;
  process.exitCode = code;
  for (const child of children) terminate(child, 'SIGTERM');
  const timer = setTimeout(() => {
    for (const child of children) terminate(child, 'SIGKILL');
  }, 10_000);
  timer.unref();
}
process.on('SIGINT', () => stop(130));
process.on('SIGTERM', () => stop(143));
for (const { name, env } of prepared) {
  if (name === 'ios' || name === 'android') {
    // Generated native directories may belong to the other app identity.
    const prebuild = spawn(
      'pnpm',
      ['--filter', '@ai-games/mobile', 'exec', 'expo', 'prebuild', '--clean', '--platform', name],
      {
        env,
        stdio: 'inherit',
        detached: process.platform !== 'win32',
      },
    );
    children.push(prebuild);
    await new Promise<void>((resolve, reject) => {
      prebuild.on('error', reject);
      prebuild.on('exit', (code) =>
        code === 0 ? resolve() : reject(new Error('Native prebuild failed.')),
      );
    });
  }
  const scripts: Record<string, string> = {
    api: 'apps/api/src/main.ts',
    worker: 'apps/worker/src/main.ts',
    migrate: 'scripts/migrate.ts',
    seed: 'scripts/seed-fixture.ts',
    live: 'scripts/test-live.ts',
    moderation: 'scripts/test-moderation-live.ts',
  };
  const command =
    name in mobileCommands
      ? ['--filter', '@ai-games/mobile', 'exec', 'expo', ...mobileCommands[name]!, ...args]
      : ['exec', 'tsx', scripts[name]!, ...args];
  console.log(`Starting ${name} (${environment}).`);
  const child = spawn('pnpm', command, {
    env,
    stdio: 'inherit',
    detached: process.platform !== 'win32',
  });
  children.push(child);
  child.on('error', () => stop(1));
  child.on('exit', (code, signal) => {
    if (!stopping) stop(code ?? (signal ? 1 : 0));
  });
}
