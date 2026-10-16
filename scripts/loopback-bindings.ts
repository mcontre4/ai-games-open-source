import http from 'node:http';
import { execFileSync } from 'node:child_process';
type Inspection = {
  Id: string;
  Name: string;
  Config: Record<string, unknown>;
  HostConfig: {
    PortBindings: Record<string, { HostIp: string; HostPort: string }[]>;
    [key: string]: unknown;
  };
  NetworkSettings: {
    Networks: Record<string, { Aliases: string[] }>;
    Ports: Record<string, { HostIp: string }[] | null>;
  };
};
// Docker Desktop may ignore a network's host_binding_ipv4 option. Explicit bindings are verified.
export async function bindSupabaseLoopback() {
  const context = JSON.parse(
    execFileSync('docker', ['context', 'inspect'], { encoding: 'utf8' }),
  )[0] as { Endpoints: { docker: { Host: string } } };
  const socketPath = context.Endpoints.docker.Host.replace('unix://', '');
  // The CLI negotiates with the selected daemon; hosted Linux engines can be older
  // than Docker Desktop. Never require one developer machine's API version.
  const apiVersion = execFileSync('docker', ['version', '--format', '{{.Server.APIVersion}}'], {
    encoding: 'utf8',
  }).trim();
  if (!/^\d+\.\d+$/.test(apiVersion)) throw new Error('Invalid Docker daemon API version.');
  const call = (method: string, path: string, body?: unknown) =>
    new Promise<unknown>((resolve, reject) => {
      const data = body === undefined ? undefined : JSON.stringify(body);
      const request = http.request(
        {
          socketPath,
          path: `/v${apiVersion}${path}`,
          method,
          headers: data
            ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
            : {},
        },
        (response) => {
          let text = '';
          response.on('data', (chunk) => (text += chunk));
          response.on('end', () => {
            if ((response.statusCode ?? 500) >= 400)
              reject(new Error(`Docker loopback binding failed (${response.statusCode}).`));
            else resolve(text ? JSON.parse(text) : null);
          });
        },
      );
      request.on('error', reject);
      request.end(data);
    });
  const names = execFileSync(
    'docker',
    ['ps', '--filter', 'label=com.supabase.cli.project=infrastructure', '--format', '{{.Names}}'],
    { encoding: 'utf8' },
  )
    .trim()
    .split('\n')
    .filter(Boolean);
  for (const name of names) {
    const inspect = (await call('GET', `/containers/${name}/json`)) as Inspection;
    if (
      !Object.values(inspect.NetworkSettings.Ports).some((bindings) =>
        bindings?.some((b) => b.HostIp === '0.0.0.0' || b.HostIp === '::'),
      )
    )
      continue;
    const hostConfig = {
      ...inspect.HostConfig,
      PortBindings: Object.fromEntries(
        Object.entries(inspect.HostConfig.PortBindings).map(([port, bindings]) => [
          port,
          bindings.map((b) => ({ ...b, HostIp: '127.0.0.1' })),
        ]),
      ),
    };
    const payload = {
      ...inspect.Config,
      HostConfig: hostConfig,
      NetworkingConfig: {
        EndpointsConfig: Object.fromEntries(
          Object.entries(inspect.NetworkSettings.Networks).map(([network, settings]) => [
            network,
            { Aliases: settings.Aliases },
          ]),
        ),
      },
    };
    const backup = `${name}-before-loopback`;
    await call('POST', `/containers/${inspect.Id}/stop?t=10`);
    await call('POST', `/containers/${inspect.Id}/rename?name=${backup}`);
    try {
      const created = (await call('POST', `/containers/create?name=${name}`, payload)) as {
        Id: string;
      };
      await call('POST', `/containers/${created.Id}/start`);
      await call('DELETE', `/containers/${inspect.Id}`);
    } catch (error) {
      await call('POST', `/containers/${inspect.Id}/rename?name=${name}`).catch(() => {});
      await call('POST', `/containers/${inspect.Id}/start`).catch(() => {});
      throw error;
    }
  }
  console.log('Supabase published ports are explicitly bound to 127.0.0.1.');
}
if (process.argv[1]?.endsWith('loopback-bindings.ts')) await bindSupabaseLoopback();
