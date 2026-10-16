import React from 'react';
import {
  View,
  Text,
  ScrollView,
  Alert,
  Pressable,
  Linking,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { router } from 'expo-router';
import { useApp, useAction } from '../../src/presentation/provider';
import { Screen, Heading, Button, ErrorText, colors, s } from '../../src/presentation/ui';
import type { Json } from '../../../../packages/domain/src/index.ts';
import type { CreatorProfile } from '../../../../packages/domain/src/profile.ts';
import { ProfileSettings } from '../../src/presentation/ProfileSettings';
import { AccountSecurity } from '../../src/presentation/AccountSecurity';
import { Avatar } from '../../src/presentation/Avatar';
import { CreditSummary } from '../../src/presentation/CreditSummary';
export default function Settings() {
  const { controller, state, account, isGuest, refresh } = useApp();
  const action = useAction();
  const [privacy, setPrivacy] = React.useState(false);
  const [blocked, setBlocked] = React.useState<CreatorProfile[] | null>(null);
  const [conflicts, setConflicts] = React.useState<
    { gameId: string; local: { state: Json }; cloud: unknown }[]
  >([]);
  return (
    <Screen>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView keyboardShouldPersistTaps="handled">
          <Heading
            eyebrow="YOUR ACCOUNT"
            title="Settings"
            description={
              isGuest
                ? 'You’re playing the bundled sample. Sign in to create and share games.'
                : controller.email
            }
          />
          <View style={s.body}>
            {account !== 'guest' && <CreditSummary credits={state.credits} />}
            <ErrorText message={action.error} />
            {!isGuest &&
              (state.profile ? (
                <ProfileSettings key={account} profile={state.profile} />
              ) : (
                <>
                  <Text style={s.small}>
                    Your profile is unavailable. Connect to your backend and try again.
                  </Text>
                  <Button
                    title="Reload profile"
                    secondary
                    busy={action.busy}
                    onPress={() => void action.run(refresh)}
                  />
                </>
              ))}
            {!isGuest && <AccountSecurity />}
            {isGuest ? (
              <Button title="Sign in or create account" onPress={() => router.push('/auth')} />
            ) : (
              <Button
                title="Sign out"
                secondary
                onPress={() =>
                  void action.run(async () => {
                    await controller.signOut();
                    await refresh();
                    router.replace('/');
                  })
                }
              />
            )}
            {!isGuest && (
              <>
                <Text style={s.label}>BLOCKED CREATORS</Text>
                <Button
                  title="Manage blocked creators"
                  secondary
                  busy={action.busy}
                  disabled={!state.online}
                  onPress={() =>
                    void action.run(async () => setBlocked(await controller.blockedCreators()))
                  }
                />
                {blocked?.length === 0 && (
                  <Text style={s.small}>You haven’t blocked any creators.</Text>
                )}
                {blocked?.map((creator) => (
                  <View key={creator.id} style={{ gap: 6 }}>
                    <View style={[s.row, { gap: 12 }]}>
                      <Avatar id={creator.avatarId} size={36} />
                      <Text style={[s.rowText, { flex: 1 }]}>@{creator.username}</Text>
                    </View>
                    <Button
                      title={`Unblock @${creator.username}`}
                      secondary
                      busy={action.busy}
                      onPress={() =>
                        void action.run(async () => {
                          await controller.unblock(creator.id);
                          setBlocked(await controller.blockedCreators());
                          await refresh();
                        })
                      }
                    />
                  </View>
                ))}
              </>
            )}
            <Text style={[s.label, { marginTop: 18 }]}>DEVICE STORAGE</Text>
            <View style={s.row}>
              <Text style={s.rowText}>Downloaded games</Text>
              <Text style={{ color: colors.mint }}>{state.installed.length}</Text>
            </View>
            <View style={s.row}>
              <Text style={s.rowText}>Game storage</Text>
              <Text style={s.small}>
                {(state.installed.reduce((n, g) => n + g.bytes, 0) / 1024 / 1024).toFixed(1)} MB
              </Text>
            </View>
            {state.installed.map((game) => (
              <View style={s.row} key={game.game.id}>
                <Text style={s.rowText}>{game.game.title}</Text>
                <Pressable
                  onPress={() =>
                    void action.run(async () => {
                      await controller.removeDownload(game.game.id);
                      await refresh();
                    })
                  }
                >
                  <Text style={s.link}>Remove</Text>
                </Pressable>
              </View>
            ))}
            <Button
              title="Sync saves now"
              secondary
              busy={action.busy}
              disabled={isGuest}
              onPress={() =>
                void action.run(async () => {
                  await controller.sync();
                  setConflicts(await controller.db.conflicts(account));
                })
              }
            />
            {conflicts.map((conflict, i) => (
              <View
                key={i}
                style={{ padding: 12, backgroundColor: colors.surface, borderRadius: 12 }}
              >
                <Text style={s.small}>
                  A newer cloud save was restored for {conflict.gameId}. Your offline copy is
                  retained.
                </Text>
                <Button
                  title="Restore my offline copy"
                  secondary
                  onPress={() =>
                    void action.run(async () => {
                      const game = state.installed.find((g) => g.game.id === conflict.gameId);
                      if (game) {
                        await controller.save(account, game.manifest, conflict.local.state);
                        await controller.sync();
                      }
                    })
                  }
                />
              </View>
            ))}
            <Button title="Privacy and data" secondary onPress={() => setPrivacy(!privacy)} />
            {!isGuest && (
              <Button
                title="Export my cloud data"
                secondary
                busy={action.busy}
                disabled={!state.online}
                onPress={() => void action.run(() => controller.exportData())}
              />
            )}
            {privacy && (
              <Text style={s.small}>
                Your email authenticates your account. Private game descriptions, saves and scores
                are stored on your backend. Your username, display name and creature identify you on
                games you share. Your bio and accessible games appear on your creator profile when
                enabled. Generation prompts are sent to OpenRouter only when you request AI
                creation. Player names and high scores appear on shared leaderboards when enabled.
                Games receive only a display name, game identifiers and their own save data. No
                advertising, analytics, contacts, location, camera or microphone access. Delete
                account removes cloud data and this account’s local records. Downloaded shared games
                may remain offline on friends’ devices.
              </Text>
            )}
            <Button
              title="Report an issue"
              secondary
              onPress={() =>
                void Linking.openURL('https://github.com/mcontre4/ai-games-open-source/issues')
              }
            />
            {!isGuest && (
              <Button
                title="Delete my account"
                secondary
                onPress={() =>
                  Alert.alert(
                    'Delete your account?',
                    'Your games, shared access and cloud saves will be permanently removed.',
                    [
                      { text: 'Cancel', style: 'cancel' },
                      {
                        text: 'Delete account',
                        style: 'destructive',
                        onPress: () =>
                          void action.run(async () => {
                            await controller.deleteAccount();
                            await refresh();
                            router.replace('/');
                          }),
                      },
                    ],
                  )
                }
              />
            )}
            <Text style={[s.small, { marginTop: 20 }]}>
              AI Games · Player 1.0. Free to create. Yours to play.
            </Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}
