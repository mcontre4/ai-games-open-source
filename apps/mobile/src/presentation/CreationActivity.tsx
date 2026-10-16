import React from 'react';
import { ActivityIndicator, Text, View, StyleSheet } from 'react-native';
import type { Generation } from '../../../../packages/domain/src/index.ts';
import { generationStatus, isCreating } from './generation';
import { colors, s } from './ui';

export function CreationActivity({ job, compact = false }: { job: Generation; compact?: boolean }) {
  const active = isCreating(job.stage);
  return (
    <View style={styles.activity}>
      <Text style={s.label}>{job.kind === 'modify' ? 'YOUR MODIFICATION' : 'YOUR GAME IDEA'}</Text>
      <Text style={styles.prompt} numberOfLines={compact ? 3 : undefined}>
        {job.prompt}
      </Text>
      <View style={styles.status} accessibilityLiveRegion="polite">
        {active && <ActivityIndicator color={colors.mint} size="small" />}
        <Text style={[styles.statusText, job.stage === 'failed' && { color: colors.danger }]}>
          {generationStatus(job.stage)}
        </Text>
      </View>
      {compact && (
        <Text style={s.small}>{active ? 'View creation progress →' : 'View details →'}</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  activity: { gap: 10, paddingVertical: 16 },
  prompt: { color: colors.text, fontSize: 18, lineHeight: 26, fontWeight: '600' },
  status: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  statusText: { color: colors.mint, fontSize: 13, fontWeight: '700', flexShrink: 1 },
});
