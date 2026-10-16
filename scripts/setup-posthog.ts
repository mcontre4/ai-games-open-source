import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { appEnvironment } from '../packages/config/src/environment.ts';
import { loadEnvironment } from './environment.ts';
import { analyticsEvents, posthogPlan } from './posthog-plan.ts';

const mode = appEnvironment(process.argv[2]);
const environment = process.argv.includes('--preview')
  ? { ...process.env }
  : loadEnvironment(mode, 'server');
const mobile = process.argv.includes('--preview') ? {} : loadEnvironment(mode, 'mobile');
const plan = posthogPlan(mode);
const tag = 'ai-games-analytics-v1';
const projectSettings = { anonymize_ips: true, autocapture_exceptions_opt_in: true };
await mkdir('work/posthog', { recursive: true });
await writeFile(
  'work/posthog/plan.json',
  JSON.stringify({ projectSettings, events: analyticsEvents, dashboards: plan }, null, 2) + '\n',
);
if (process.argv.includes('--preview')) {
  console.log('PostHog plan saved to work/posthog/plan.json. No hosted changes made.');
  process.exit(0);
}
const token = environment.POSTHOG_CLI_API_KEY;
const projectId = environment.POSTHOG_CLI_PROJECT_ID;
if (!token || !projectId || !/^\d+$/.test(projectId))
  throw new Error(
    'Set private POSTHOG_CLI_API_KEY and POSTHOG_CLI_PROJECT_ID to configure PostHog. The reviewed plan is in work/posthog/plan.json.',
  );
const host = new URL(environment.POSTHOG_CLI_HOST || 'https://us.posthog.com');
if (host.protocol !== 'https:') throw new Error('PostHog management requires HTTPS.');
const prefix = `/api/projects/${projectId}/`;
async function api<T>(path: string, method = 'GET', data?: unknown): Promise<T> {
  const target = new URL(path, host);
  if (target.origin !== host.origin || !target.pathname.startsWith(prefix))
    throw new Error('Unexpected PostHog API destination.');
  const response = await fetch(target, {
    method,
    redirect: 'error',
    signal: AbortSignal.timeout(30000),
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    ...(data === undefined ? {} : { body: JSON.stringify(data) }),
  });
  if (!response.ok)
    throw new Error(
      `PostHog ${method} ${target.pathname} failed (${response.status}). Credentials and response body withheld.`,
    );
  return response.json() as Promise<T>;
}
interface NamedObject {
  id: number | string;
  name: string;
  tags?: string[];
}
async function list<T>(path: string): Promise<T[]> {
  const results: T[] = [];
  let next: string | null = path;
  while (next) {
    const page: { results: T[]; next?: string | null } = await api(next);
    results.push(...page.results);
    next = page.next ?? null;
  }
  return results;
}
// Validate access before writes; the returned ingestion token is never printed.
const project = await api<{ id: number; api_token: string }>(prefix);
if (String(project.id) !== projectId || !project.api_token)
  throw new Error('PostHog project does not match the configured project.');
await api(prefix, 'PATCH', projectSettings);
const definitions = await list<NamedObject>(`${prefix}event_definitions/?limit=100`);
for (const [name, description] of Object.entries(analyticsEvents)) {
  const current = definitions.find((item) => item.name === name);
  if (!current)
    await api(`${prefix}event_definitions/`, 'POST', {
      name,
      description,
      tags: [tag],
      verified: false,
    });
  else if (current.tags?.includes(tag))
    await api(`${prefix}event_definitions/${current.id}/`, 'PATCH', { description });
}
const dashboards = await list<NamedObject>(`${prefix}dashboards/?limit=100`);
const insights = await list<NamedObject>(`${prefix}insights/?limit=100`);
for (const dashboard of plan) {
  const existing = dashboards.find(
    (item) => item.name === dashboard.name && item.tags?.includes(tag),
  );
  const saved =
    existing ??
    (await api<NamedObject>(`${prefix}dashboards/`, 'POST', {
      name: dashboard.name,
      description: dashboard.description,
      tags: [tag],
      pinned: true,
    }));
  for (const insight of dashboard.insights) {
    // Validate the query server-side before saving the definition.
    await api(`${prefix}query/`, 'POST', { query: insight.query.source });
    const current = insights.find((item) => item.name === insight.name && item.tags?.includes(tag));
    if (current)
      await api(`${prefix}insights/${current.id}/`, 'PATCH', {
        description: insight.description,
        query: insight.query,
      });
    else
      await api(`${prefix}insights/`, 'POST', { ...insight, dashboards: [saved.id], tags: [tag] });
  }
  console.log(`Configured ${dashboard.name} (dashboard ${saved.id}).`);
}
async function writeVariables(path: string, values: Record<string, string>) {
  let contents = '';
  try {
    contents = await readFile(path, 'utf8');
  } catch {
    /* New ignored env file. */
  }
  for (const [key, value] of Object.entries(values)) {
    if (!/^[A-Z0-9_]+$/.test(key) || /[\r\n]/.test(value))
      throw new Error('Invalid environment value.');
    const pattern = new RegExp(`^${key}=.*$`, 'm');
    contents = pattern.test(contents)
      ? contents.replace(pattern, `${key}=${value}`)
      : `${contents.trimEnd()}\n${key}=${value}\n`;
  }
  await writeFile(path, contents, { mode: 0o600 });
}
const ingestionHost =
  host.hostname === 'eu.posthog.com'
    ? 'https://eu.i.posthog.com'
    : host.hostname === 'us.posthog.com'
      ? 'https://us.i.posthog.com'
      : host.origin;
const mobileVariables = {
  ...Object.fromEntries(Object.entries(mobile).filter(([key]) => key.startsWith('EXPO_PUBLIC_'))),
  EXPO_PUBLIC_APP_ENV: mode,
  EXPO_PUBLIC_POSTHOG_API_KEY: project.api_token,
  EXPO_PUBLIC_POSTHOG_HOST: ingestionHost,
  EXPO_PUBLIC_POSTHOG_ENABLED: 'true',
  EXPO_PUBLIC_ANALYTICS_ENVIRONMENT: environment.ANALYTICS_ENVIRONMENT || 'development',
  EXPO_PUBLIC_APP_RELEASE: environment.APP_RELEASE || '0.1.0',
};
await writeVariables(`.env.${mode}`, {
  POSTHOG_API_KEY: project.api_token,
  POSTHOG_HOST: ingestionHost,
  POSTHOG_ENABLED: 'true',
  ...mobileVariables,
});
await writeVariables(`apps/mobile/.env.${mode}`, mobileVariables);
console.log(
  'PostHog configured. Runtime ingestion keys saved to ignored env files; restart API, worker and Metro. No private management key was copied to the mobile app.',
);
