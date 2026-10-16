import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import type { AccountProfile } from '../../../../packages/domain/src/profile.ts';
import { profileUpdateSchema } from '../../../../packages/contracts/src/index.ts';
export const profileCache = {
  async load(account: string): Promise<AccountProfile | null> {
    const key = `profile.${account}`;
    const value =
      Platform.OS === 'web' ? localStorage.getItem(key) : await SecureStore.getItemAsync(key);
    if (!value) return null;
    try {
      const { id, createdAt, ...input } = JSON.parse(value);
      const parsed = profileUpdateSchema.safeParse(input);
      return id === account && typeof createdAt === 'string' && parsed.success
        ? { ...parsed.data, id, createdAt }
        : null;
    } catch {
      return null;
    }
  },
  async save(profile: AccountProfile) {
    const key = `profile.${profile.id}`,
      value = JSON.stringify(profile);
    if (Platform.OS === 'web') localStorage.setItem(key, value);
    else await SecureStore.setItemAsync(key, value);
  },
  async remove(account: string) {
    const key = `profile.${account}`;
    if (Platform.OS === 'web') localStorage.removeItem(key);
    else await SecureStore.deleteItemAsync(key);
  },
};
