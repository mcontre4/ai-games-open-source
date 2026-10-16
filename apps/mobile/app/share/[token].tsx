import React from 'react';
import { View, Text } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useApp, useAction } from '../../src/presentation/provider';
import { Screen, Heading, Button, ErrorText, s } from '../../src/presentation/ui';
export default function Share() {
  const { token } = useLocalSearchParams<{ token: string }>();
  const { controller, isGuest, refresh } = useApp();
  const action = useAction();
  return (
    <Screen>
      <Heading
        eyebrow="AN INVITATION TO PLAY"
        title="A new world. From a friend."
        description="Add this game to your library. Your progress and scores will be entirely your own."
      />
      <View style={s.body}>
        <ErrorText message={action.error} />
        {isGuest ? (
          <Button title="Sign in to accept" onPress={() => router.push('/auth')} />
        ) : (
          <Button
            title="Accept game"
            busy={action.busy}
            onPress={() =>
              void action.run(async () => {
                const game = await controller.accept(token);
                await refresh();
                router.replace({ pathname: '/game/[id]', params: { id: game.id } });
              })
            }
          />
        )}
        <Text style={s.small}>
          Invitations expire after seven days. The creator can revoke online access.
        </Text>
        <Button title="Back to library" secondary onPress={() => router.replace('/')} />
      </View>
    </Screen>
  );
}
