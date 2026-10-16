import { AnalyticsBoundary } from '../src/presentation/AnalyticsBoundary';
import { captureMobile } from '../src/adapters/analytics';
import React from 'react';
import { Stack, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AppProvider } from '../src/presentation/provider';
export default function Root() {
  const segments = useSegments();
  const screen = segments.join('/');
  React.useEffect(() => {
    captureMobile('screen_viewed', { route: screen || '(tabs)' });
  }, [screen]);
  return (
    <AnalyticsBoundary>
      <SafeAreaProvider>
        <AppProvider>
          <StatusBar style="light" />
          <Stack
            screenOptions={{
              headerShown: false,
              contentStyle: { backgroundColor: '#090d12' },
              animation: 'fade',
            }}
          >
            <Stack.Screen name="(tabs)" />
            <Stack.Screen name="auth" />
            <Stack.Screen name="game/[id]" />
            <Stack.Screen name="player/[id]" options={{ gestureEnabled: false }} />
            <Stack.Screen name="generation/[id]" />
            <Stack.Screen name="share/[token]" />
            <Stack.Screen name="modify/[id]" />
            <Stack.Screen name="recovery" />
            <Stack.Screen name="profile/[username]" />
          </Stack>
        </AppProvider>
      </SafeAreaProvider>
    </AnalyticsBoundary>
  );
}
