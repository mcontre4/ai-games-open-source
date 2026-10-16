// React Native's AbortSignal does not provide the browser timeout() helper.
export async function timedRequest<T>(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  read: (response: Response) => Promise<T>,
  fetcher: typeof fetch = fetch,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await read(await fetcher(url, { ...init, signal: controller.signal }));
  } finally {
    clearTimeout(timer);
  }
}
