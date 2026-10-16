import React from 'react';
import { View, Text, Pressable } from 'react-native';
import type { GenerationSpeed } from '../../../../packages/domain/src/index';
import { colors, s } from './ui';

const options = [
  { value: 'regular', label: 'Regular', model: 'Sol', detail: 'Standard AI speed · Base cost' },
  {
    value: 'fast',
    label: 'Fast',
    model: 'Sol Fast',
    detail: 'Faster AI responses · About 2× AI cost (+100%)',
  },
  {
    value: 'ultra-fast',
    label: 'Ultra fast',
    model: 'Sol Ultra fast',
    detail: 'Fastest AI responses · About 6× AI cost (+500%)',
  },
] as const;

export function GenerationSpeedSelector({
  value,
  onChange,
}: {
  value: GenerationSpeed;
  onChange: (value: GenerationSpeed) => void;
}) {
  return (
    <View style={{ gap: 10 }}>
      <Text style={s.label}>CREATION SPEED</Text>
      <View accessibilityRole="radiogroup" accessibilityLabel="Creation speed" style={{ gap: 8 }}>
        {options.map((option) => (
          <Pressable
            key={option.value}
            accessibilityRole="radio"
            accessibilityLabel={option.label}
            accessibilityHint={`${option.model}. ${option.detail}`}
            accessibilityState={{ checked: value === option.value }}
            aria-checked={value === option.value}
            onPress={() => onChange(option.value)}
            style={{
              padding: 14,
              borderRadius: 15,
              borderWidth: 1,
              borderColor: value === option.value ? colors.mint : colors.line,
              backgroundColor: colors.surface,
              gap: 4,
            }}
          >
            <Text
              style={{
                color: value === option.value ? colors.mint : colors.text,
                fontWeight: '700',
              }}
            >
              {value === option.value ? '●' : '○'} {option.label} · {option.model}
            </Text>
            <Text style={s.small}>{option.detail}</Text>
          </Pressable>
        ))}
      </View>
      <Text style={s.small}>
        Speed applies to AI planning, coding and review. Artwork and build time still vary, so
        completion time isn’t guaranteed. Cost comparisons use Sol’s token rates; the total game
        cost depends on usage and artwork.
      </Text>
    </View>
  );
}
