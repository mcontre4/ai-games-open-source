import React from 'react';
import {
  View,
  Text,
  ScrollView,
  Pressable,
  ImageBackground,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
  useWindowDimensions,
} from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import type { Game, Generation } from '../../../../packages/domain/src/index.ts';
import { useApp, useAction } from './provider';
import { CreationActivity } from './CreationActivity';
import { generationStatus, isCreating } from './generation';
import { Avatar } from './Avatar';
import { Screen, Heading, Field, Button, ErrorText, Fade, colors, s } from './ui';

// Discovery uses a featured game and shelves; the creator library uses a compact grid.
export function GameCatalog({ personal = false }: { personal?: boolean }) {
  const { state, controller, refresh, ready, account, isGuest } = useApp();
  const { width } = useWindowDimensions();
  const [search, setSearch] = React.useState('');
  const action = useAction();
  const games = state.games.filter(
    (game) =>
      game.currentVersionId &&
      (!personal || game.ownerId === account) &&
      `${game.title} ${game.description}`.toLowerCase().includes(search.toLowerCase()),
  );
  const liveGames = games.filter((game) => !game.fixture);
  const samples = games.filter((game) => game.fixture);
  const featured = liveGames[0] ?? samples[0];
  const creations = state.jobs.filter(
    (job) =>
      job.userId === account &&
      (isCreating(job.stage) ||
        (job.stage !== 'ready' &&
          !state.games.find((game) => game.id === job.gameId)?.currentVersionId)) &&
      `${job.prompt} ${state.games.find((game) => game.id === job.gameId)?.title ?? ''}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  const libraryCreations = creations.filter(
    (job, index) => creations.findIndex((other) => other.gameId === job.gameId) === index,
  );
  const columns = width >= 700 ? 3 : 2;
  const tileWidth = (width - 48 - (columns - 1) * 12) / columns;
  const open = (game: Game) => router.push({ pathname: '/game/[id]', params: { id: game.id } });
  const play = (game: Game) =>
    void action.run(async () => {
      if (!state.installed.some((item) => item.game.id === game.id)) {
        await controller.download(game.id, game.currentVersionId!);
        await refresh();
      }
      router.push({ pathname: '/player/[id]', params: { id: game.id } });
    });
  function cover(game: Game) {
    const installed = state.installed.find((item) => item.game.id === game.id);
    return game.fixture
      ? require('../../assets/neon-cover.png')
      : installed
        ? { uri: `${installed.directory}/assets/background.png` }
        : undefined;
  }
  function tile(game: Game, grid = false) {
    return (
      <Pressable
        key={game.id}
        accessibilityRole="button"
        accessibilityLabel={`Open ${game.title}`}
        onPress={() => open(game)}
        style={({ pressed }) => [
          styles.tile,
          { width: grid ? tileWidth : Math.min(width * 0.62, 280) },
          pressed && styles.pressed,
        ]}
      >
        <ImageBackground source={cover(game)} style={styles.tileCover}>
          {!cover(game) && (
            <Ionicons name="game-controller-outline" size={48} color={colors.mint} />
          )}
          <View style={styles.tileBadge}>
            <Text style={styles.tag}>
              {game.fixture ? 'OFFLINE SAMPLE' : (game.view ?? '2d').toUpperCase()}
            </Text>
          </View>
        </ImageBackground>
        <Text style={styles.tileTitle} numberOfLines={2}>
          {game.title}
        </Text>
        <Text style={styles.description} numberOfLines={2}>
          {game.description}
        </Text>
      </Pressable>
    );
  }
  function creationTile(job: Generation) {
    const game = state.games.find((game) => game.id === job.gameId);
    const active = isCreating(job.stage);
    return (
      <Pressable
        key={job.gameId}
        accessibilityRole="button"
        accessibilityLabel={`View ${job.kind === 'modify' ? 'modification' : 'creation'} progress: ${job.prompt}`}
        onPress={() => router.push({ pathname: '/generation/[id]', params: { id: job.id } })}
        style={({ pressed }) => [styles.tile, { width: tileWidth }, pressed && styles.pressed]}
      >
        <ImageBackground source={game ? cover(game) : undefined} style={styles.tileCover}>
          <View style={styles.creationOverlay}>
            {active ? (
              <ActivityIndicator
                testID={`creation-loading-${job.gameId}`}
                accessibilityLabel="Game creation in progress"
                size="large"
                color={colors.mint}
              />
            ) : (
              <Ionicons
                name={job.stage === 'failed' ? 'alert-circle-outline' : 'close-circle-outline'}
                size={40}
                color={colors.muted}
              />
            )}
          </View>
          <View style={styles.tileBadge}>
            <Text style={styles.tag}>
              {active ? (job.kind === 'modify' ? 'UPDATING' : 'CREATING') : 'VIEW DETAILS'}
            </Text>
          </View>
        </ImageBackground>
        <Text style={styles.tileTitle} numberOfLines={2}>
          {game?.title ?? 'Your new game'}
        </Text>
        <Text style={styles.description} numberOfLines={2}>
          {job.prompt}
        </Text>
        <Text style={styles.creationStatus} accessibilityLiveRegion="polite">
          {generationStatus(job.stage)}
        </Text>
      </Pressable>
    );
  }
  function shelf(title: string, items: Game[]) {
    if (!items.length) return null;
    return (
      <View style={styles.shelf} key={title}>
        <Text style={[styles.sectionTitle, { marginHorizontal: 24 }]}>{title}</Text>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.rail}
        >
          {items.map((game) => tile(game))}
        </ScrollView>
      </View>
    );
  }
  return (
    <Screen>
      <ScrollView
        refreshControl={
          <RefreshControl
            refreshing={action.busy}
            onRefresh={() => void action.run(refresh)}
            tintColor={colors.mint}
          />
        }
        contentContainerStyle={{ paddingBottom: 32 }}
      >
        <View style={styles.top}>
          <Text style={styles.brand}>
            ai games<Text style={{ color: colors.mint }}> ✦</Text>
          </Text>
          <Pressable accessibilityLabel="Account" onPress={() => router.push('/(tabs)/settings')}>
            {state.profile ? (
              <Avatar id={state.profile.avatarId} size={42} />
            ) : (
              <View style={styles.avatar}>
                <Text style={s.link}>
                  {isGuest ? '↗' : controller.email.charAt(0).toUpperCase()}
                </Text>
              </View>
            )}
          </Pressable>
        </View>
        {personal ? (
          <Heading
            eyebrow="YOUR CREATIONS"
            title="Your Games"
            description="Every world you’ve made, in one place."
          />
        ) : (
          <View style={styles.discoveryHeading}>
            <Text accessibilityRole="header" style={styles.sectionTitle}>
              All Games
            </Text>
            <Text style={s.small}>
              {state.online ? 'Find your next game.' : 'Browse your offline games.'}
            </Text>
          </View>
        )}
        <View style={styles.search}>
          <Field
            placeholder={personal ? 'Search your creations' : 'Search games'}
            accessibilityLabel="Search games"
            value={search}
            onChangeText={setSearch}
          />
          <ErrorText message={action.error || controller.guestLinkError} />
        </View>
        {!ready ? (
          <ActivityIndicator color={colors.mint} />
        ) : (
          <Fade>
            {!personal && featured && (
              <ImageBackground source={cover(featured)} style={styles.hero}>
                {!cover(featured) && (
                  <View style={styles.heroArt}>
                    <Ionicons name="game-controller-outline" size={160} color={colors.mint} />
                  </View>
                )}
                <View style={styles.heroCopy}>
                  <Text style={styles.tag}>
                    {featured.fixture ? 'BUNDLED OFFLINE SAMPLE' : 'FEATURED GAME'}
                  </Text>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Open ${featured.title}`}
                    onPress={() => open(featured)}
                  >
                    <Text style={styles.heroTitle}>{featured.title}</Text>
                  </Pressable>
                  <Text style={styles.heroDescription} numberOfLines={3}>
                    {featured.description}
                  </Text>
                  <View style={styles.heroActions}>
                    <View style={{ flex: 1 }}>
                      <Button
                        title="Play"
                        accessibilityLabel={`Play ${featured.title}`}
                        testID={featured.fixture ? 'play-fixture' : undefined}
                        icon="play"
                        busy={action.busy}
                        onPress={() => play(featured)}
                      />
                    </View>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Details for ${featured.title}`}
                      onPress={() => open(featured)}
                      style={styles.info}
                    >
                      <Ionicons name="information-circle-outline" size={26} color={colors.text} />
                    </Pressable>
                  </View>
                </View>
              </ImageBackground>
            )}
            {!personal && creations.length > 0 && (
              <View style={styles.activity}>
                <Text style={styles.sectionTitle}>Your creations</Text>
                {creations.map((job) => (
                  <Pressable
                    key={job.id}
                    accessibilityRole="button"
                    accessibilityLabel={`View ${job.kind === 'modify' ? 'modification' : 'creation'} progress: ${job.prompt}`}
                    onPress={() =>
                      router.push({ pathname: '/generation/[id]', params: { id: job.id } })
                    }
                  >
                    <CreationActivity job={job} compact />
                  </Pressable>
                ))}
              </View>
            )}
            {personal ? (
              <View style={styles.grid}>
                {libraryCreations.map(creationTile)}
                {games
                  .filter((game) => !libraryCreations.some((job) => job.gameId === game.id))
                  .map((game) => tile(game, true))}
              </View>
            ) : (
              <>
                {shelf(
                  'New games',
                  [...liveGames].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)),
                )}
                {shelf(
                  'Continue playing',
                  liveGames
                    .filter((game) =>
                      state.installed.some((item) => item.game.id === game.id && item.lastPlayed),
                    )
                    .sort(
                      (a, b) =>
                        Date.parse(
                          state.installed.find((item) => item.game.id === b.id)!.lastPlayed!,
                        ) -
                        Date.parse(
                          state.installed.find((item) => item.game.id === a.id)!.lastPlayed!,
                        ),
                    ),
                )}
                {shelf(
                  'Ready to play offline',
                  liveGames.filter((game) =>
                    state.installed.some((item) => item.game.id === game.id),
                  ),
                )}
                {shelf(
                  '3D & isometric worlds',
                  liveGames.filter((game) => game.view === '3d' || game.view === 'isometric'),
                )}
                {shelf(
                  'Shared with you',
                  liveGames.filter((game) => !game.public && game.ownerId !== account),
                )}
                {shelf('Offline samples', samples)}
              </>
            )}
            {games.length === 0 && creations.length === 0 && (
              <View style={styles.empty}>
                <Text style={styles.sectionTitle}>
                  {search
                    ? 'No matching games'
                    : personal
                      ? 'Your library starts here'
                      : 'No games here yet'}
                </Text>
                <Text style={s.small}>
                  {search
                    ? 'Try another title or description.'
                    : personal
                      ? 'Create your first game and it will appear here.'
                      : 'Start with an idea and create a game.'}
                </Text>
              </View>
            )}
          </Fade>
        )}
        <View style={styles.footer}>
          <Button title="Create a game" icon="add" onPress={() => router.push('/(tabs)/create')} />
        </View>
      </ScrollView>
    </Screen>
  );
}
const styles = StyleSheet.create({
  top: {
    paddingHorizontal: 24,
    paddingTop: 16,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  brand: { color: colors.text, fontSize: 26, fontWeight: '800', letterSpacing: -1 },
  avatar: {
    height: 42,
    width: 42,
    borderRadius: 21,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  discoveryHeading: { paddingHorizontal: 24, paddingTop: 24, gap: 6 },
  search: { paddingHorizontal: 24, paddingVertical: 18 },
  hero: {
    minHeight: 390,
    backgroundColor: colors.surface,
    justifyContent: 'flex-end',
    overflow: 'hidden',
  },
  heroArt: { alignItems: 'flex-end', paddingRight: 36, paddingTop: 30, opacity: 0.3 },
  heroCopy: { padding: 24, paddingTop: 30, backgroundColor: '#090d12cc' },
  tag: { fontSize: 10, fontWeight: '800', letterSpacing: 1.5, color: colors.mint },
  heroTitle: {
    fontSize: 40,
    lineHeight: 44,
    fontWeight: '800',
    letterSpacing: -1.5,
    color: colors.text,
    marginTop: 12,
    maxWidth: 560,
  },
  heroDescription: { color: '#c6d4e2', fontSize: 15, lineHeight: 23, marginTop: 12, maxWidth: 480 },
  heroActions: {
    flexDirection: 'row',
    gap: 12,
    alignItems: 'center',
    marginTop: 20,
    maxWidth: 400,
  },
  info: { padding: 14, borderRadius: 28, backgroundColor: colors.surface },
  sectionTitle: { color: colors.text, fontSize: 22, fontWeight: '700', letterSpacing: -0.5 },
  shelf: { marginTop: 28 },
  rail: { paddingHorizontal: 24, gap: 14, paddingTop: 14 },
  tile: { marginBottom: 16 },
  tileCover: {
    height: 145,
    backgroundColor: colors.surface,
    borderRadius: 12,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  tileBadge: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    padding: 10,
    backgroundColor: '#090d12cc',
  },
  creationOverlay: {
    position: 'absolute',
    inset: 0,
    backgroundColor: '#090d12aa',
    alignItems: 'center',
    justifyContent: 'center',
  },
  creationStatus: {
    color: colors.mint,
    fontSize: 12,
    lineHeight: 18,
    marginTop: 8,
    fontWeight: '600',
  },
  tileTitle: { color: colors.text, fontSize: 16, fontWeight: '700', marginTop: 10 },
  description: { color: colors.muted, fontSize: 12, lineHeight: 18, marginTop: 5 },
  pressed: { opacity: 0.75, transform: [{ scale: 0.98 }] },
  grid: { paddingHorizontal: 24, flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  activity: { paddingHorizontal: 24, marginVertical: 24 },
  empty: { margin: 24, gap: 12 },
  footer: { marginHorizontal: 24, marginTop: 24 },
});
