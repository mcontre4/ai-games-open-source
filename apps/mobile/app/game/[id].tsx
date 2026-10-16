import React from 'react';
import { View, Text, ScrollView, Pressable, ImageBackground, Alert } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useApp, useAction } from '../../src/presentation/provider';
import { Screen, Heading, Button, Field, ErrorText, colors, s } from '../../src/presentation/ui';
import type { Game, GameVersion } from '../../../../packages/domain/src/index.ts';
import { CreatorLink } from '../../src/presentation/Avatar';
export default function Details() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { controller, state, account, refresh } = useApp();
  const [game, setGame] = React.useState<
    (Game & { versions: GameVersion[]; leaderboard: { player: string; score: number }[] }) | null
  >(null);
  const [shares, setShares] = React.useState<
    { id: string; revoked: boolean; playerIds: string[] }[]
  >([]);
  const [editing, setEditing] = React.useState(false);
  const [title, setTitle] = React.useState('');
  const [description, setDescription] = React.useState('');
  const [saved, setSaved] = React.useState(false);
  const [report, setReport] = React.useState<string | null>(null);
  const action = useAction();
  React.useEffect(() => {
    void action.run(async () => setGame(await controller.details(id)));
  }, [id, controller]);
  const installed = state.installed.find((i) => i.game.id === id);
  return (
    <Screen>
      <ScrollView>
        <Pressable style={s.back} onPress={() => router.back()}>
          <Text style={s.link}>← Games</Text>
        </Pressable>
        <ImageBackground
          source={
            game?.fixture
              ? require('../../assets/neon-cover.png')
              : installed
                ? { uri: `${installed.directory}/assets/background.png` }
                : undefined
          }
          style={{
            backgroundColor: colors.surface,
            height: 260,
            marginHorizontal: 24,
            borderRadius: 24,
            overflow: 'hidden',
          }}
        />
        <Heading
          eyebrow={game?.fixture ? 'BUNDLED OFFLINE SAMPLE' : 'YOUR PERSONAL ARCADE'}
          title={game?.title ?? 'Loading…'}
          description={game?.description}
        />
        <View style={s.body}>
          {game?.creator && <CreatorLink creator={game.creator} />}
          {game?.fixture && !game.creator && (
            <Text style={s.small}>Created by AI Games · deterministic offline sample</Text>
          )}
          <View style={s.row}>
            <Text style={s.small}>{game?.versions.length ?? 0} version(s)</Text>
            <Text style={s.small}>
              {((game?.versions[0]?.packageBytes ?? 0) / 1024 / 1024).toFixed(1)} MB ·{' '}
              {game?.orientation}
            </Text>
          </View>
          <ErrorText message={action.error} />
          {installed ? (
            <Button
              title="Play game"
              icon="play"
              onPress={() => router.push({ pathname: '/player/[id]', params: { id } })}
            />
          ) : (
            <Button
              title={game?.fixture ? 'Download bundled sample' : 'Download game'}
              icon="download-outline"
              busy={action.busy}
              disabled={!game?.currentVersionId}
              onPress={() =>
                void action.run(async () => {
                  await controller.download(id, game!.currentVersionId!);
                  await refresh();
                })
              }
            />
          )}
          <Text style={s.small}>
            {installed
              ? 'Ready for offline play. Saves stay on this device and sync when you reconnect.'
              : 'All game code and artwork will be stored on your device.'}
          </Text>
          {game?.ownerId === account && (
            <>
              <Button
                title="Edit title & description"
                secondary
                disabled={action.busy || editing}
                onPress={() => {
                  setTitle(game.title);
                  setDescription(game.description);
                  setSaved(false);
                  setEditing(true);
                }}
              />
              {editing && (
                <View style={{ gap: 12 }}>
                  <Text style={s.label}>TITLE</Text>
                  <Field
                    accessibilityLabel="Game title"
                    value={title}
                    onChangeText={setTitle}
                    maxLength={100}
                  />
                  <Text style={s.label}>DESCRIPTION</Text>
                  <Field
                    accessibilityLabel="Game description"
                    value={description}
                    onChangeText={setDescription}
                    maxLength={1000}
                    multiline
                  />
                  <Button
                    title="Save game details"
                    busy={action.busy}
                    disabled={!title.trim() || !description.trim()}
                    onPress={() =>
                      void action.run(async () => {
                        const updated = await controller.updateGameMetadata(id, title, description);
                        setGame({ ...game, ...updated });
                        setEditing(false);
                        setSaved(true);
                        await refresh();
                      })
                    }
                  />
                  <Button
                    title="Cancel editing"
                    secondary
                    disabled={action.busy}
                    onPress={() => setEditing(false)}
                  />
                </View>
              )}
              {saved && (
                <Text accessibilityRole="alert" style={s.small}>
                  Game details saved.
                </Text>
              )}
              <Button
                title="Modify this game"
                secondary
                icon="sparkles-outline"
                onPress={() => router.push({ pathname: '/modify/[id]', params: { id } })}
              />
              <Button
                title="Share with a friend"
                secondary
                icon="share-outline"
                busy={action.busy}
                onPress={() =>
                  void action.run(async () => {
                    await controller.share(id);
                    setShares(await controller.shares(id));
                  })
                }
              />
              <Button
                title="Manage share access"
                secondary
                onPress={() => void action.run(async () => setShares(await controller.shares(id)))}
              />
              {shares.map((invitation) => (
                <View style={s.row} key={invitation.id}>
                  <Text style={s.small}>
                    {invitation.revoked ? 'Revoked' : `${invitation.playerIds.length} player(s)`}
                  </Text>
                  {!invitation.revoked && (
                    <Pressable
                      onPress={() =>
                        void action.run(async () => {
                          await controller.revoke(invitation.id);
                          setShares(await controller.shares(id));
                        })
                      }
                    >
                      <Text style={s.link}>Revoke</Text>
                    </Pressable>
                  )}
                </View>
              ))}
            </>
          )}
          {game && game.versions.length > 1 && (
            <>
              <Text style={s.label}>PREVIOUS VERSIONS</Text>
              {game.versions.map((v) => (
                <Pressable
                  key={v.id}
                  style={s.row}
                  onPress={() =>
                    void action.run(async () => {
                      await controller.download(id, v.id);
                      await refresh();
                    })
                  }
                >
                  <Text style={s.rowText}>Version {v.number}</Text>
                  <Text style={s.link}>Download</Text>
                </Pressable>
              ))}
            </>
          )}
          <Text style={[s.label, { marginTop: 18 }]}>LEADERBOARD</Text>
          {game?.leaderboard.length ? (
            game.leaderboard.map((row, i) => (
              <View key={`${row.player}-${i}`} style={s.row}>
                <Text style={s.rowText}>
                  {i + 1} {row.player}
                </Text>
                <Text style={{ color: colors.mint, fontWeight: '800' }}>{row.score}</Text>
              </View>
            ))
          ) : (
            <Text style={s.small}>
              Your first run could set the pace. Scores are recorded independently for each player.
            </Text>
          )}
          {installed && (
            <Button
              title="Delete local download"
              secondary
              onPress={() =>
                void action.run(async () => {
                  await controller.removeDownload(id);
                  await refresh();
                })
              }
            />
          )}
          <Button title="Report this game" secondary onPress={() => setReport('')} />
          {report !== null && (
            <>
              <Field
                placeholder="Tell us what happened"
                value={report}
                onChangeText={setReport}
                multiline
              />
              <Button
                title="Send report"
                busy={action.busy}
                disabled={report.length < 3}
                onPress={() =>
                  void action.run(async () => {
                    await controller.report(id, report);
                    setReport(null);
                  })
                }
              />
            </>
          )}
          {game && !game.fixture && game.ownerId !== account && (
            <Button
              title="Block creator"
              secondary
              onPress={() =>
                void action.run(async () => {
                  await controller.block(game.ownerId);
                  await refresh();
                  router.replace('/');
                })
              }
            />
          )}
          {!game?.fixture && (
            <Button
              title="Remove from library"
              secondary
              onPress={() =>
                void action.run(async () => {
                  await controller.removeLibrary(id);
                  await refresh();
                  router.replace('/');
                })
              }
            />
          )}
          {game?.ownerId === account && (
            <Button
              title="Delete game"
              secondary
              onPress={() =>
                Alert.alert(
                  'Delete game?',
                  'Shared players will lose access. Local downloads can be removed separately.',
                  [
                    { text: 'Keep game', style: 'cancel' },
                    {
                      text: 'Delete',
                      style: 'destructive',
                      onPress: () =>
                        void action.run(async () => {
                          await controller.deleteGame(id);
                          await refresh();
                          router.replace('/');
                        }),
                    },
                  ],
                )
              }
            />
          )}
        </View>
      </ScrollView>
    </Screen>
  );
}
