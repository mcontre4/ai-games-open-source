import React from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import type { GameView } from '../../../../packages/domain/src/index';
import { colors, s } from './ui';

const options = [
  {
    value: '2d',
    title: '2D',
    caption: 'Side view',
    image: require('../../assets/game-views/2d.png'),
    description: 'Flat worlds and sprites. Great for platformers, puzzles and arcade games.',
  },
  {
    value: '3d',
    title: '3D',
    caption: 'Perspective',
    image: require('../../assets/game-views/3d.png'),
    description:
      'Step into a world with depth. Great for runners like Subway Surfers and 3D adventures.',
  },
  {
    value: 'isometric',
    title: 'Isometric',
    caption: '3D · angled view',
    image: require('../../assets/game-views/isometric.png'),
    description:
      'A 3D world viewed diagonally from above. Great for island adventures, builders and strategy.',
  },
] as const;

export function GameViewSelector({
  value,
  onChange,
}: {
  value: GameView;
  onChange: (view: GameView) => void;
}) {
  return (
    <View style={{ gap: 10 }}>
      <Text style={s.label}>GAME VIEW</Text>
      <View accessibilityRole="radiogroup" accessibilityLabel="Game view" style={styles.options}>
        {options.map((option) => (
          <Pressable
            key={option.value}
            accessibilityRole="radio"
            accessibilityLabel={option.title}
            accessibilityState={{ checked: value === option.value }}
            aria-checked={value === option.value}
            onPress={() => onChange(option.value)}
            style={({ pressed }) => [
              styles.option,
              value === option.value && styles.selected,
              pressed && { opacity: 0.8, transform: [{ scale: 0.98 }] },
            ]}
          >
            <Image source={option.image} style={styles.image} accessible={false} />
            <View style={styles.label}>
              <Text style={styles.title}>{option.title}</Text>
              <Text style={{ color: value === option.value ? colors.mint : colors.muted }}>
                {value === option.value ? '●' : '○'}
              </Text>
            </View>
            <Text style={styles.caption}>{option.caption}</Text>
          </Pressable>
        ))}
      </View>
      <Text style={s.small}>{options.find((option) => option.value === value)!.description}</Text>
      <Text style={[s.small, { fontSize: 11 }]}>
        Illustrative examples. Your game is built around your idea.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  options: { flexDirection: 'row', gap: 8 },
  option: {
    flex: 1,
    minWidth: 0,
    borderRadius: 14,
    overflow: 'hidden',
    backgroundColor: colors.surface,
    borderWidth: 2,
    borderColor: 'transparent',
    paddingBottom: 10,
  },
  selected: { borderColor: colors.mint },
  image: { width: '100%', height: 110, resizeMode: 'cover' },
  label: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 8,
    marginTop: 10,
  },
  title: { fontSize: 14, fontWeight: '700', color: colors.text },
  caption: { fontSize: 10, color: colors.muted, paddingHorizontal: 8, marginTop: 4 },
});
