import React from 'react';
import { View, Text, ScrollView, Pressable, ActivityIndicator } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import type { Profile } from '../../../../packages/domain/src/profile.ts';
import type { Game } from '../../../../packages/domain/src/index.ts';
import { useApp } from '../../src/presentation/provider';
import { Avatar } from '../../src/presentation/Avatar';
import { Screen, Button, ErrorText, Fade, colors, s } from '../../src/presentation/ui';
export default function Creator() {
  const { username } = useLocalSearchParams<{ username: string }>();
  const { controller, account, isGuest, refresh } = useApp();
  const [data, setData] = React.useState<{ profile: Profile; games: Game[] } | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [retry, setRetry] = React.useState(0);
  React.useEffect(() => {
    let active = true;
    setData(null);
    setError(null);
    setLoading(true);
    void controller
      .creatorProfile(username)
      .then((result) => {
        if (active) setData(result);
      })
      .catch((e) => {
        if (active) setError(e instanceof Error ? e.message : 'Profile unavailable.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [username, controller, account, retry]);
  return (
    <Screen>
      <ScrollView>
        <Pressable
          accessibilityRole="button"
          style={s.back}
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
        >
          <Text style={s.link}>← Back</Text>
        </Pressable>
        <View style={s.body}>
          {loading && (
            <ActivityIndicator accessibilityLabel="Loading profile" color={colors.mint} />
          )}
          <ErrorText message={error} />
          {error && (
            <Button
              title={isGuest ? 'Sign in to view profiles' : 'Try again'}
              secondary
              onPress={() => (isGuest ? router.push('/auth') : setRetry((n) => n + 1))}
            />
          )}
          {data && (
            <Fade>
              <View style={{ gap: 18 }}>
                <Avatar id={data.profile.avatarId} size={112} />
                <Text accessibilityRole="header" style={s.title}>
                  {data.profile.displayName}
                </Text>
                <Text style={s.link}>@{data.profile.username}</Text>
                {!!data.profile.bio && <Text style={s.description}>{data.profile.bio}</Text>}
                <Text style={s.small}>
                  Joined{' '}
                  {new Date(data.profile.createdAt).toLocaleDateString(undefined, {
                    month: 'long',
                    year: 'numeric',
                  })}
                </Text>
                {account === data.profile.id ? (
                  <Button
                    title="Edit profile"
                    secondary
                    onPress={() => router.push('/(tabs)/settings')}
                  />
                ) : (
                  <Button
                    title={`Block @${data.profile.username}`}
                    secondary
                    onPress={() => {
                      void controller
                        .block(data.profile.id)
                        .then(refresh)
                        .then(() => router.replace('/'))
                        .catch((e) =>
                          setError(e instanceof Error ? e.message : 'Could not block creator.'),
                        );
                    }}
                  />
                )}
                {!data.profile.profileVisible && (
                  <Text style={s.small}>Your creator profile is hidden from other players.</Text>
                )}
                <Text style={s.label}>CREATED GAMES · {data.games.length}</Text>
                <Text style={s.small}>Only games you have access to appear here.</Text>
                {data.games.length === 0 && (
                  <Text style={s.rowText}>No games available to you yet.</Text>
                )}
                {data.games.map((game) => (
                  <Pressable
                    key={game.id}
                    accessibilityRole="button"
                    accessibilityLabel={`Open ${game.title}`}
                    style={s.row}
                    onPress={() => router.push({ pathname: '/game/[id]', params: { id: game.id } })}
                  >
                    <View style={{ flex: 1, gap: 5 }}>
                      <Text style={s.rowText}>{game.title}</Text>
                      <Text style={s.small}>
                        {game.fixture
                          ? 'Deterministic sample'
                          : game.public
                            ? 'Public game'
                            : account === game.ownerId
                              ? 'Your private game'
                              : 'Shared with you'}
                      </Text>
                      <Text style={s.small} numberOfLines={2}>
                        {game.description}
                      </Text>
                    </View>
                    <Text style={s.link}>→</Text>
                  </Pressable>
                ))}
              </View>
            </Fade>
          )}
        </View>
      </ScrollView>
    </Screen>
  );
}
