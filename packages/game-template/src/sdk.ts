type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
declare global {
  interface Window {
    ReactNativeWebView?: { postMessage: (message: string) => void };
    webkit?: { messageHandlers: { gameBridge: { postMessage: (message: string) => void } } };
    GameSDK: typeof GameSDK;
    __gameSDKReceive: (response: unknown) => void;
  }
}
let sequence = 0;
const pending = new Map<
  string,
  {
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }
>();
function request(type: string, payload: Record<string, unknown> = {}): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const id = `sdk_${++sequence}`;
    const message = JSON.stringify({ protocol: 1, id, type, ...payload });
    if (new TextEncoder().encode(message).byteLength > 70 * 1024) {
      reject(new Error('Message too large.'));
      return;
    }
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error('Host request timed out.'));
    }, 5000);
    pending.set(id, { resolve, reject, timer });
    if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(message);
    else if (window.webkit?.messageHandlers.gameBridge)
      window.webkit.messageHandlers.gameBridge.postMessage(message);
    else {
      clearTimeout(timer);
      pending.delete(id);
      reject(new Error('A native game host is required.'));
    }
  });
}
export const GameSDK = {
  loadState: () => request('loadState') as Promise<Json | null>,
  saveState: (state: Json) => request('saveState', { state }),
  submitScore: (score: number) => request('submitScore', { score }),
  getPlayer: () => request('getPlayer') as Promise<{ name: string }>,
  getGameInfo: () =>
    request('getGameInfo') as Promise<{ id: string; versionId: string; title: string }>,
};
if (typeof window !== 'undefined') {
  window.GameSDK = GameSDK;
  window.__gameSDKReceive = (raw: unknown) => {
    if (!raw || typeof raw !== 'object') return;
    const response = raw as {
      protocol?: unknown;
      id?: unknown;
      ok?: unknown;
      value?: unknown;
      error?: unknown;
    };
    if (
      response.protocol !== 1 ||
      typeof response.id !== 'string' ||
      typeof response.ok !== 'boolean'
    )
      return;
    const p = pending.get(response.id);
    if (!p) return;
    clearTimeout(p.timer);
    pending.delete(response.id);
    if (response.ok) p.resolve(response.value);
    else
      p.reject(new Error(typeof response.error === 'string' ? response.error : 'Request failed.'));
  };
}
