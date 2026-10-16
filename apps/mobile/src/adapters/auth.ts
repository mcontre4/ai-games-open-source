import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { createClient } from '@supabase/supabase-js';
import { supabaseUrl } from '../config/environment';
const storage = {
  getItem: async (key: string) =>
    Platform.OS === 'web' ? localStorage.getItem(key) : SecureStore.getItemAsync(key),
  setItem: async (key: string, value: string) => {
    if (Platform.OS === 'web') localStorage.setItem(key, value);
    else await SecureStore.setItemAsync(key, value);
  },
  removeItem: async (key: string) => {
    if (Platform.OS === 'web') localStorage.removeItem(key);
    else await SecureStore.deleteItemAsync(key);
  },
};
const configuredUrl = supabaseUrl;
export const supabase = createClient(
  Platform.OS === 'android' ? configuredUrl.replace('127.0.0.1', '10.0.2.2') : configuredUrl,
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || 'local-configuration-required',
  {
    auth: {
      storage,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
      flowType: 'pkce',
    },
  },
);
