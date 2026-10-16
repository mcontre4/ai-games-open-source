import {
  analyticsAccount,
  captureMobile,
  captureMobileError,
  flushMobile,
  mobileAnalytics,
} from '../adapters/analytics';
import React from 'react';
import { AppState } from 'react-native';
import { supabase } from '../adapters/auth';
import { MobileController, type LibraryState } from '../application/controller';
import type { Generation } from '../../../../packages/domain/src/index.ts';
const controller = new MobileController(mobileAnalytics);
const initial: LibraryState = {
  games: [],
  installed: [],
  jobs: [],
  online: false,
  aiAvailable: false,
};
const Context = React.createContext<{
  controller: MobileController;
  state: LibraryState;
  refresh: () => Promise<void>;
  rememberGeneration: (job: Generation) => void;
  ready: boolean;
  account: string;
  isGuest: boolean;
}>({
  controller,
  state: initial,
  refresh: async () => {},
  rememberGeneration: () => {},
  ready: false,
  account: 'guest',
  isGuest: true,
});
export function AppProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = React.useState(initial);
  const [ready, setReady] = React.useState(false);
  const [isGuest, setIsGuest] = React.useState(true);
  const [account, setAccount] = React.useState('guest');
  const rememberGeneration = React.useCallback((job: Generation) => {
    if (job.userId !== controller.account) return;
    setState((current) => ({
      ...current,
      jobs: [job, ...current.jobs.filter((existing) => existing.id !== job.id)],
    }));
  }, []);
  const refresh = React.useCallback(async () => {
    const requestedAccount = controller.account;
    const next = await controller.refresh();
    if (requestedAccount !== controller.account) return;
    setState(next);
    setAccount(controller.account);
    setIsGuest(controller.isGuest);
  }, []);
  React.useEffect(() => {
    let active = true;
    void supabase.auth
      .getSession()
      .then(({ data }) => {
        if (!active) return;
        controller.account = data.session?.user.id ?? 'guest';
        controller.isGuest = !data.session || data.session.user.is_anonymous === true;
        controller.email = data.session?.user.email ?? '';
        controller.playerName = String(
          data.session?.user.user_metadata.display_name || 'Player',
        ).slice(0, 40);
        analyticsAccount(controller.isGuest ? 'guest' : controller.account);
        captureMobile('app_opened', { authenticated: !controller.isGuest });
        return refresh();
      })
      .finally(() => {
        if (active) setReady(true);
      });
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      const previousAccount = controller.account;
      if (event === 'SIGNED_OUT' && !controller.isGuest) captureMobile('account_signed_out');
      if (previousAccount !== (session?.user.id ?? 'guest')) setState(initial);
      controller.account = session?.user.id ?? 'guest';
      controller.isGuest = !session || session.user.is_anonymous === true;
      controller.email = session?.user.email ?? '';
      controller.playerName = String(session?.user.user_metadata.display_name || 'Player').slice(
        0,
        40,
      );
      analyticsAccount(controller.isGuest ? 'guest' : controller.account);
      if (event === 'SIGNED_IN' && !controller.isGuest && previousAccount !== controller.account)
        captureMobile('account_signed_in');
      if (event === 'PASSWORD_RECOVERY') captureMobile('account_recovery_opened');
      setAccount(controller.account);
      setIsGuest(controller.isGuest);
      setTimeout(() => void refresh(), 0);
    });
    const interval = setInterval(() => void refresh(), 15000);
    const subscription = AppState.addEventListener('change', (value) => {
      captureMobile(value === 'active' ? 'app_foregrounded' : 'app_backgrounded');
      if (value === 'active') void refresh();
      else {
        void controller.sync(false);
        flushMobile();
      }
    });
    return () => {
      active = false;
      data.subscription.unsubscribe();
      clearInterval(interval);
      subscription.remove();
    };
  }, [refresh]);
  return (
    <Context.Provider
      value={{ controller, state, refresh, rememberGeneration, ready, account, isGuest }}
    >
      {children}
    </Context.Provider>
  );
}
export function useApp() {
  return React.useContext(Context);
}
export function useAction() {
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const run = async <T,>(fn: () => Promise<T>): Promise<T | undefined> => {
    setBusy(true);
    setError(null);
    try {
      return await fn();
    } catch (e) {
      captureMobileError(e, { operation: 'user_action' });
      setError(e instanceof Error ? e.message : 'Something went wrong. Try again.');
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, run, setError };
}
