import React from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
interface Props {
  directory: string;
  response: string;
  command: string;
  onMessage: (raw: string) => void;
  onError: (error: string) => void;
  style?: StyleProp<ViewStyle>;
}
export function GameSurface(_p: Props) {
  return (
    <div style={{ color: '#c8d0e0', padding: 32, background: '#070b19', height: '100%' }}>
      Offline games use the native iOS or Android player. The browser preview shows the library and
      creation screens. Run the separate game E2E harness to inspect Neon Comet in a browser.
    </div>
  );
}
