import * as Crypto from 'expo-crypto';
import { playSession } from '../../../../packages/application/src/play-analytics.ts';
import { mobileAnalytics } from '../../src/adapters/analytics';
import React from 'react';
import { View, Text, Pressable, ActivityIndicator, AppState } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import * as Orientation from 'expo-screen-orientation';
import { Ionicons } from '@expo/vector-icons';
import { useApp, useAction } from '../../src/presentation/provider';
import { HandleGameMessage } from '../../../../packages/application/src/bridge.ts';
import { GameSurface } from '../../src/adapters/GameSurface';
import type { InstalledGame } from '../../src/adapters/sqlite';
import { colors, ErrorText, Button } from '../../src/presentation/ui';
export default function Player() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { controller, account, isGuest, refresh } = useApp();
  const [installed, setInstalled] = React.useState<InstalledGame | null>(null);
  const [response, setResponse] = React.useState('');
  const [command, setCommand] = React.useState('');
  const action = useAction();
  const play = React.useRef<ReturnType<typeof playSession> | null>(null);
  const bridge = React.useRef<HandleGameMessage | null>(null);
  const recordedPlay = React.useRef(false);
  React.useEffect(() => {
    let active = true;
    recordedPlay.current = false;
    void action.run(async () => {
      const game = await controller.launch(id);
      if (!active) return;
      play.current = playSession(
        mobileAnalytics,
        {
          accountId: account,
          gameId: game.game.id,
          versionId: game.manifest.versionId,
          ownerId: game.game.ownerId,
          fixture: game.game.fixture,
          firstPlay: game.firstPlay,
          sessionId: Crypto.randomUUID(),
        },
        Date.now,
      );
      setInstalled(game);
      bridge.current = new HandleGameMessage(
        {
          load: (a, g) => controller.db.load(a, g),
          save: (a, m, value) => controller.save(a, m, value),
          score: (a, m, value) => controller.score(a, m, value),
        },
        {
          accountId: account,
          manifest: game.manifest,
          playerName: isGuest ? 'Guest' : controller.playerName,
        },
        Date.now,
      );
      await Orientation.lockAsync(
        game.manifest.orientation === 'landscape'
          ? Orientation.OrientationLock.LANDSCAPE
          : Orientation.OrientationLock.PORTRAIT_UP,
      );
    });
    const sub = AppState.addEventListener('change', (state) => {
      play.current?.activity(state === 'active');
      if (state !== 'active') setCommand(`pause:${Date.now()}`);
    });
    return () => {
      active = false;
      play.current?.end('screen_closed');
      play.current = null;
      bridge.current = null;
      sub.remove();
      void Orientation.unlockAsync();
      void controller.sync();
    };
  }, [id, account, controller]);
  const message = (raw: string) => {
    if (raw === '{"type":"host_runtime_error"}') {
      play.current?.error(new Error('Game runtime error'), 'game_runtime');
      action.setError('The game stopped unexpectedly. Return to the library and reopen it.');
      return;
    }
    const currentPlay = play.current;
    const currentBridge = bridge.current;
    void currentBridge
      ?.execute(raw)
      .then((value) => {
        if (currentPlay !== play.current) return;
        if (value.ok) {
          currentPlay?.ready();
          if (installed && !recordedPlay.current) {
            recordedPlay.current = true;
            void controller
              .markPlayed(account, installed)
              .catch((error) => currentPlay?.error(error, 'record_play'));
          }
        } else currentPlay?.error(new Error('Game persistence failed'), 'game_bridge_persistence');
        setResponse(JSON.stringify(value));
      })
      .catch((error) => {
        currentPlay?.error(error, 'game_bridge_rejected');
        action.setError('The game sent an invalid request. It was rejected.');
      });
  };
  return (
    <View style={{ flex: 1, backgroundColor: '#070b19' }}>
      {installed ? (
        <GameSurface
          directory={installed.directory}
          response={response}
          command={command}
          onMessage={message}
          onError={(error) => {
            play.current?.error(new Error(error));
            action.setError(error);
          }}
          style={{ flex: 1 }}
        />
      ) : (
        <ActivityIndicator color={colors.mint} style={{ marginTop: 100 }} />
      )}
      <Pressable
        accessibilityLabel="Exit game"
        testID="exit-game"
        onPress={() => {
          play.current?.end('exit_button');
          setCommand(`pause:${Date.now()}`);
          void controller.sync();
          void refresh();
          router.replace('/');
        }}
        style={{
          position: 'absolute',
          top: 48,
          left: 15,
          backgroundColor: '#101a29dd',
          borderRadius: 20,
          height: 36,
          width: 36,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Ionicons name="close" color={colors.text} size={20} />
      </Pressable>
      {action.error && (
        <View
          style={{
            position: 'absolute',
            left: 20,
            right: 20,
            bottom: 80,
            padding: 20,
            backgroundColor: colors.surface,
            borderRadius: 20,
          }}
        >
          <Text style={{ color: colors.text, fontWeight: '700' }}>Game player</Text>
          <ErrorText message={action.error} />
          <Button title="Return to library" onPress={() => router.replace('/')} />
        </View>
      )}
    </View>
  );
}
