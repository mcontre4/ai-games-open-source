import { captureMobile } from './analytics';
import { supabase } from './auth';
import { Platform } from 'react-native';
import { timedRequest } from './timed-request';
import { clientAttestation, orderedAppRequest } from './integrity';
import { apiUrl } from '../config/environment';
import { appIntegrityMode } from '../../../../packages/config/src/environment';
export class ApiClient {
  readonly baseUrl: string;
  constructor(
    url = apiUrl,
    private readonly now: () => number = Date.now,
  ) {
    this.baseUrl = Platform.OS === 'android' ? url.replace('127.0.0.1', '10.0.2.2') : url;
  }
  private readonly attestation = clientAttestation({
    challenge: (token, purpose) =>
      this.integrityBootstrap('/integrity/challenges', token, { purpose }),
    register: (token, input) => this.integrityBootstrap('/integrity/instances', token, input),
  });
  private async integrityBootstrap<T>(path: string, token: string, body: unknown): Promise<T> {
    return timedRequest(
      `${this.baseUrl}${path}`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      },
      15_000,
      async (response) => {
        if (!response.ok) {
          const error = (await response.json()) as { message?: string };
          throw new Error(error.message || 'App verification failed.');
        }
        return response.status === 204 ? (undefined as T) : (response.json() as Promise<T>);
      },
    );
  }
  private async fetch(path: string, options: RequestInit = {}): Promise<Response> {
    const started = this.now();
    const route = path
      .replace(/\?.*$/, '')
      .replace(/\/games\/[^/]+/g, '/games/:id')
      .replace(/\/versions\/[^/]+/g, '/versions/:versionId')
      .replace(/\/profiles\/[^/]+/g, '/profiles/:username')
      .replace(/\/blocks\/[^/]+/g, '/blocks/:creatorId')
      .replace(/\/(generations|shares|library)\/[^/]+/g, '/$1/:id');
    const metadata = { method: options.method || 'GET', route };
    try {
      const execute = async () => {
        if (path === '/health') return fetch(`${this.baseUrl}${path}`, options);
        const mode = appIntegrityMode(process.env.EXPO_PUBLIC_APP_INTEGRITY_MODE);
        if (mode === 'disabled') return fetch(`${this.baseUrl}${path}`, options);
        const local = mode === 'local-development';
        if (local) {
          if (
            (process.env.EXPO_PUBLIC_APP_ENV || 'production') === 'production' ||
            (!['127.0.0.1', 'localhost', '10.0.2.2'].includes(new URL(this.baseUrl).hostname) &&
              !(
                process.env.EXPO_PUBLIC_APP_ENV === 'test' &&
                new URL(this.baseUrl).hostname.endsWith('.invalid')
              ))
          )
            throw new Error(
              'App verification may only be bypassed for explicit local development.',
            );
          return fetch(`${this.baseUrl}${path}`, options);
        }
        const { data } = await supabase.auth.getSession();
        const token = new Headers(options.headers).get('Authorization')?.slice(7);
        if (!data.session || token !== data.session.access_token)
          throw new Error('Account changed. Try again.');
        const headers = await this.attestation.execute({
          userId: data.session.user.id,
          token,
          method: options.method || 'GET',
          path,
          body: typeof options.body === 'string' ? JSON.parse(options.body) : undefined,
        });
        return fetch(`${this.baseUrl}${path}`, {
          ...options,
          headers: { ...Object.fromEntries(new Headers(options.headers).entries()), ...headers },
        });
      };
      const response = path === '/health' ? await execute() : await orderedAppRequest(execute);
      captureMobile('client_api_request_completed', {
        ...metadata,
        duration_ms: this.now() - started,
        status_code: response.status,
        request_id: response.headers.get('X-Request-ID'),
      });
      if (!response.ok)
        captureMobile('client_api_request_failed', { ...metadata, status_code: response.status });
      return response;
    } catch (error) {
      captureMobile('client_api_request_failed', {
        ...metadata,
        duration_ms: this.now() - started,
        error_code: 'NETWORK_ERROR',
      });
      throw error;
    }
  }
  async request<T>(
    path: string,
    method = 'GET',
    body?: unknown,
    expectedAccount?: string,
  ): Promise<T> {
    const { data } = await supabase.auth.getSession();
    if (!data.session) throw new Error('Sign in to continue.');
    if (expectedAccount && data.session.user.id !== expectedAccount)
      throw new Error('Account changed.');
    return timedRequest(
      `${this.baseUrl}${path}`,
      {
        method,
        headers: {
          Authorization: `Bearer ${data.session.access_token}`,
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      },
      45_000,
      async (response) => {
        if (!response.ok) {
          const error = (await response.json()) as { code: string; message: string };
          throw new Error(error.code === 'REVISION_CONFLICT' ? 'REVISION_CONFLICT' : error.message);
        }
        if (response.status === 204) return undefined as T;
        return response.json() as Promise<T>;
      },
      (_url, options) => this.fetch(path, options),
    );
  }
  async package(gameId: string, versionId: string): Promise<Uint8Array> {
    const { data } = await supabase.auth.getSession();
    if (!data.session) throw new Error('Sign in to download games.');
    return timedRequest(
      `${this.baseUrl}/games/${gameId}/versions/${versionId}/download`,
      {
        headers: { Authorization: `Bearer ${data.session.access_token}` },
      },
      60_000,
      async (response) => {
        if (!response.ok) throw new Error('Download failed. Check your connection and access.');
        const length = Number(response.headers.get('Content-Length'));
        if (length > 30 * 1024 * 1024) throw new Error('Package too large.');
        const buffer = new Uint8Array(await response.arrayBuffer());
        if (buffer.length > 30 * 1024 * 1024) throw new Error('Package too large.');
        return buffer;
      },
      (_url, options) => this.fetch(`/games/${gameId}/versions/${versionId}/download`, options),
    );
  }
  async health() {
    return timedRequest(
      `${this.baseUrl}/health`,
      {},
      3000,
      async (response) => {
        if (!response.ok) throw new Error('Backend is unavailable.');
        return response.json() as Promise<{ aiAvailable: boolean }>;
      },
      (_url, options) => this.fetch('/health', options),
    );
  }
}
