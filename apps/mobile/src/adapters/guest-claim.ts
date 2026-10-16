import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import type { GuestClaimStoragePort, PendingGuestClaim } from '../application/guest-linking';
const key = 'pending-guest-claim';
export const guestClaimStorage: GuestClaimStoragePort = {
  load: async () => {
    const stored =
      Platform.OS === 'web' ? localStorage.getItem(key) : await SecureStore.getItemAsync(key);
    return stored ? (JSON.parse(stored) as PendingGuestClaim) : null;
  },
  save: async (claim) => {
    const stored = JSON.stringify(claim);
    if (Platform.OS === 'web') localStorage.setItem(key, stored);
    else await SecureStore.setItemAsync(key, stored);
  },
  remove: async () => {
    if (Platform.OS === 'web') localStorage.removeItem(key);
    else await SecureStore.deleteItemAsync(key);
  },
};
