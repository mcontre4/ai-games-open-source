// Browser harness: real local Supabase/API, with a same-origin relay for Expo web.
import { createServer as httpServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { loadDevelopmentTestEnvironment, cleanEnvironment } from './environment.ts';
import { spawn } from 'node:child_process';
import { configSchema } from '../packages/config/src/index.ts';
import { compose } from '../packages/adapters/src/composition.ts';
import { createServer } from '../apps/api/src/server.ts';
loadDevelopmentTestEnvironment();
// Tests must never deliver fixture identities/events to a live PostHog project.
process.env.POSTHOG_ENABLED = 'false';
process.env.EXPO_PUBLIC_POSTHOG_ENABLED = 'false';
const port = Number(process.env.PROFILE_UI_PORT || 4173);
if (!Number.isInteger(port) || port < 1024 || port > 65535)
  throw new Error('Invalid PROFILE_UI_PORT');
const build = spawn(
  'pnpm',
  [
    '--filter',
    '@ai-games/mobile',
    'exec',
    'expo',
    'export',
    '--clear',
    '--platform',
    'web',
    '--output-dir',
    `../../work/profile-web-${port}`,
  ],
  {
    stdio: 'inherit',
    env: {
      ...cleanEnvironment(process.env),
      ...Object.fromEntries(
        Object.entries(process.env).filter(([key]) => key.startsWith('EXPO_PUBLIC_')),
      ),
      APP_ENV: 'development',
      EXPO_PUBLIC_APP_ENV: 'development',
      EXPO_PUBLIC_APP_INTEGRITY_MODE: 'local-development',
      EXPO_NO_DOTENV: '1',
      EXPO_PUBLIC_API_URL: `http://127.0.0.1:${port}/api`,
    },
  },
);
await new Promise<void>((resolveBuild, reject) => {
  build.on('error', reject);
  build.on('exit', (code) =>
    code === 0 ? resolveBuild() : reject(new Error(`Expo export failed: ${code}`)),
  );
});
const services = compose(
  configSchema.parse({
    ...process.env,
    APP_ENV: 'test',
    // The profile fixture verifies metered balances independently of local runtime switches.
    GENERATION_CREDITS_ENABLED: 'true',
    APP_INTEGRITY_MODE: 'local-development',
    API_HOST: '127.0.0.1',
  }),
);
const api = await createServer(services);
const root = resolve(`work/profile-web-${port}`);
const types: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.png': 'image/png',
  '.zip': 'application/zip',
  '.ttf': 'font/ttf',
  '.json': 'application/json',
};
const server = httpServer(async (req, res) => {
  try {
    const path = new URL(req.url!, 'http://127.0.0.1').pathname;
    if (path.startsWith('/api/')) {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const body = Buffer.concat(chunks).toString();
      const result = await api.inject({
        method: req.method as 'GET',
        url: req.url!.slice(4),
        headers: {
          ...(req.headers.authorization ? { authorization: req.headers.authorization } : {}),
          ...(req.headers['content-type'] ? { 'content-type': req.headers['content-type'] } : {}),
        },
        ...(body ? { payload: body } : {}),
      });
      res.writeHead(result.statusCode, {
        'Content-Type': result.headers['content-type'] ?? 'application/json',
      });
      res.end(result.rawPayload);
      return;
    }
    let file = resolve(root, '.' + decodeURIComponent(path));
    if (!file.startsWith(root + '/')) file = resolve(root, 'index.html');
    let data: Buffer;
    try {
      data = await readFile(file);
    } catch {
      file = resolve(root, 'index.html');
      data = await readFile(file);
    }
    res.writeHead(200, { 'Content-Type': types[extname(file)] ?? 'application/octet-stream' });
    res.end(data);
  } catch {
    res.writeHead(500);
    res.end('Test server request failed.');
  }
});
server.listen(port, '127.0.0.1');
const shutdown = async () => {
  server.close();
  await api.close();
  await services.db.close();
  process.exit(0);
};
process.on('SIGTERM', () => void shutdown());
process.on('SIGINT', () => void shutdown());
