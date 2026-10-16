import { execFileSync } from 'node:child_process';
import { generateKeyPairSync, createPublicKey } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { parseEnv } from 'node:util';
import { validateEndpoint, mobilePublicKeys } from '../packages/config/src/environment.ts';
if (process.env.APP_ENV === 'production')
  throw new Error('Local setup cannot run in production mode.');
const status = JSON.parse(
  execFileSync(
    'pnpm',
    ['exec', 'supabase', 'status', '--workdir', 'infrastructure', '--output', 'json'],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] },
  ),
) as Record<string, string>;
await mkdir('work/keys', { recursive: true });
let publicPem: string;
try {
  publicPem = await readFile('work/keys/public.pem', 'utf8');
} catch {
  const pair = generateKeyPairSync('ed25519');
  publicPem = pair.publicKey.export({ type: 'spki', format: 'pem' }).toString();
  await writeFile(
    'work/keys/private.pem',
    pair.privateKey.export({ type: 'pkcs8', format: 'pem' }),
    { mode: 0o600 },
  );
  await writeFile('work/keys/public.pem', publicPem);
}
const raw = createPublicKey(publicPem)
  .export({ type: 'spki', format: 'der' })
  .subarray(-32)
  .toString('hex');
const replacements: Record<string, string> = {
  APP_ENV: 'development',
  ANALYTICS_ENVIRONMENT: 'development',
  EXPO_PUBLIC_APP_ENV: 'development',
  EXPO_PUBLIC_ANALYTICS_ENVIRONMENT: 'development',
  EXPO_PUBLIC_API_URL: 'http://127.0.0.1:4100',
  DATABASE_URL: status.DB_URL!,
  SUPABASE_URL: status.API_URL!,
  SUPABASE_ANON_KEY: status.ANON_KEY!,
  SUPABASE_SERVICE_ROLE_KEY: status.SERVICE_ROLE_KEY!,
  EXPO_PUBLIC_SUPABASE_URL: status.API_URL!,
  EXPO_PUBLIC_SUPABASE_ANON_KEY: status.ANON_KEY!,
  EXPO_PUBLIC_PACKAGE_SIGNING_KEY: raw,
};
let base: string;
try {
  base = await readFile('.env.development', 'utf8');
} catch {
  try {
    const legacy = await readFile('.env', 'utf8');
    const values = parseEnv(legacy);
    if (values.APP_ENV === 'production') throw new Error('Production legacy file.');
    if (values.EXPO_PUBLIC_API_URL)
      validateEndpoint(values.EXPO_PUBLIC_API_URL, 'development', 'EXPO_PUBLIC_API_URL');
    validateEndpoint(values.SUPABASE_URL, 'development', 'SUPABASE_URL');
    const database = new URL(values.DATABASE_URL || '');
    validateEndpoint(`http://${database.host}`, 'development', 'DATABASE_URL host');
    base = legacy;
  } catch {
    base = await readFile('.env.example', 'utf8');
  }
}
const previous = parseEnv(base);
replacements.APP_INTEGRITY_MODE = previous.APP_INTEGRITY_MODE || 'local-development';
replacements.EXPO_PUBLIC_APP_INTEGRITY_MODE =
  previous.EXPO_PUBLIC_APP_INTEGRITY_MODE || 'local-development';
if (previous.APP_ENV && previous.APP_ENV !== 'development')
  throw new Error('Refusing to reuse production credentials in development setup.');
if (previous.EXPO_PUBLIC_API_URL)
  validateEndpoint(previous.EXPO_PUBLIC_API_URL, 'development', 'EXPO_PUBLIC_API_URL');
validateEndpoint(previous.SUPABASE_URL, 'development', 'SUPABASE_URL');
const previousDatabase = new URL(previous.DATABASE_URL || '');
validateEndpoint(`http://${previousDatabase.host}`, 'development', 'DATABASE_URL host');
for (const [key, value] of Object.entries(replacements)) {
  if (!value) throw new Error(`Missing local ${key}.`);
  const pattern = new RegExp(`^${key}=.*$`, 'm');
  base = pattern.test(base)
    ? base.replace(pattern, `${key}=${value}`)
    : `${base.trimEnd()}\n${key}=${value}\n`;
}
await writeFile('.env.development', base, { mode: 0o600 });
await writeFile(
  'apps/mobile/.env.development',
  base
    .split('\n')
    .filter((line) =>
      mobilePublicKeys.includes(line.split('=')[0] as (typeof mobilePublicKeys)[number]),
    )
    .join('\n') + '\n',
  { mode: 0o600 },
);
console.log('Development .env files and signing keys are ready. No AI key was added.');
