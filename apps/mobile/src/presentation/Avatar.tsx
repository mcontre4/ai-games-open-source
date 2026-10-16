import React from 'react';
import { Image, Pressable, Text, View } from 'react-native';
import { router } from 'expo-router';
import {
  avatarIds,
  type AvatarId,
  type CreatorProfile,
} from '../../../../packages/domain/src/profile.ts';
import { colors, s } from './ui';
export { avatarIds };
const sources: Record<AvatarId, number> = {
  blob: require('../../assets/creatures/blob.png'),
  sprout: require('../../assets/creatures/sprout.png'),
  noodle: require('../../assets/creatures/noodle.png'),
  puddle: require('../../assets/creatures/puddle.png'),
  crumb: require('../../assets/creatures/crumb.png'),
  wiggle: require('../../assets/creatures/wiggle.png'),
  moss: require('../../assets/creatures/moss.png'),
  pip: require('../../assets/creatures/pip.png'),
  fizz: require('../../assets/creatures/fizz.png'),
  orbit: require('../../assets/creatures/orbit.png'),
};
export function Avatar({ id = 'blob', size = 48 }: { id?: AvatarId; size?: number }) {
  return (
    <Image
      source={sources[id] ?? sources.blob}
      accessibilityLabel={`${id} creature`}
      style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: colors.surface }}
    />
  );
}
export function CreatorLink({ creator }: { creator: CreatorProfile }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`View @${creator.username}'s profile`}
      onPress={() =>
        router.push({ pathname: '/profile/[username]', params: { username: creator.username } })
      }
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        paddingVertical: 12,
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <Avatar id={creator.avatarId} size={36} />
      <View style={{ flex: 1 }}>
        <Text style={s.rowText}>{creator.displayName}</Text>
        <Text style={s.link}>@{creator.username}</Text>
      </View>
      <Text style={s.link}>→</Text>
    </Pressable>
  );
}
