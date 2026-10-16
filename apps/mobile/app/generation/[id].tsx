import React from 'react';
import { View, Text, ScrollView, ActivityIndicator } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useApp, useAction } from '../../src/presentation/provider';
import { Screen, Heading, Button, ErrorText, colors, s } from '../../src/presentation/ui';
import { CreationActivity } from '../../src/presentation/CreationActivity';
import { generationStages, isCreating } from '../../src/presentation/generation';
import type { Generation } from '../../../../packages/domain/src/index.ts';

export default function GenerationScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { controller, state, refresh, rememberGeneration, account } = useApp();
  const [loadedJob, setLoadedJob] = React.useState<Generation | null>(null);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const job =
    loadedJob?.id === id && loadedJob.userId === account
      ? loadedJob
      : state.jobs.find((item) => item.id === id && item.userId === account);
  const action = useAction();
  React.useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const load = async () => {
      try {
        const next = await controller.api.request<Generation>(
          `/generations/${id}`,
          'GET',
          undefined,
          account,
        );
        if (!active) return;
        setLoadedJob(next);
        rememberGeneration(next);
        setLoadError(null);
        if (!isCreating(next.stage)) {
          void refresh();
          return;
        }
      } catch {
        if (!active) return;
        setLoadError('Couldn’t update progress. Reconnecting…');
      }
      if (active) timer = setTimeout(() => void load(), 3000);
    };
    void load();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [id, controller, account, refresh, rememberGeneration]);
  const position = generationStages.findIndex(([value]) => value === job?.stage);
  const active = job ? isCreating(job.stage) : false;
  return (
    <Screen>
      <ScrollView>
        <Heading
          eyebrow={job?.kind === 'modify' ? 'YOUR NEW VERSION' : 'YOUR GAME CREATION'}
          title={
            job?.stage === 'ready'
              ? 'Your game\nis ready.'
              : job?.stage === 'failed'
                ? 'Creation\nfailed.'
                : job?.stage === 'cancelled'
                  ? 'Creation\ncancelled.'
                  : job
                    ? job.kind === 'modify'
                      ? 'Creating your\nnew version.'
                      : 'Creating\nyour game.'
                    : 'Loading\nyour creation.'
          }
          description={
            job?.stage === 'ready'
              ? 'Your game is ready to download and play.'
              : job?.stage === 'failed'
                ? job.progressSaved
                  ? 'Your progress is saved. Resume to continue where creation stopped.'
                  : 'This creation stopped before it was ready. You can retry it.'
                : job?.stage === 'cancelled'
                  ? 'This creation has stopped.'
                  : 'Creating a game can take several minutes. You can return to your library and check progress there.'
          }
        />
        <View style={s.body}>
          {job ? <CreationActivity job={job} /> : <ActivityIndicator color={colors.mint} />}
          {(active || job?.stage === 'ready') &&
            generationStages.map(([stage, label], i) => {
              const complete = position > i || job?.stage === 'ready';
              const current = job?.stage === stage;
              return (
                <View key={stage} style={s.row}>
                  <Text
                    style={[
                      s.rowText,
                      { color: current ? colors.mint : complete ? colors.text : colors.muted },
                    ]}
                  >
                    {complete ? '✓' : '○'} {label}
                  </Text>
                  {current && <Text style={s.small}>Working</Text>}
                </View>
              );
            })}
          {loadError && (
            <Text accessibilityLiveRegion="polite" style={s.small}>
              {loadError}
            </Text>
          )}
          <ErrorText message={action.error ?? job?.error} />
          {job?.stage === 'ready' && (
            <Button
              title="Open my game"
              onPress={() => router.replace({ pathname: '/game/[id]', params: { id: job.gameId } })}
            />
          )}
          {job?.stage === 'failed' && (
            <Button
              title={job.progressSaved ? 'Resume creation' : 'Retry creation'}
              busy={action.busy}
              onPress={() =>
                void action.run(async () => {
                  const next = await controller.api.request<{
                    generation: Generation;
                    generationId: string;
                  }>(`/generations/${id}/retry`, 'POST', undefined, account);
                  rememberGeneration(next.generation);
                  router.replace({
                    pathname: '/generation/[id]',
                    params: { id: next.generationId },
                  });
                })
              }
            />
          )}
          {job && ['failed', 'cancelled'].includes(job.stage) && (
            <Button
              title={job.kind === 'modify' ? 'Try a new modification' : 'Try another creation'}
              onPress={() =>
                router.replace(
                  job.kind === 'modify'
                    ? { pathname: '/modify/[id]', params: { id: job.gameId } }
                    : '/(tabs)/create',
                )
              }
            />
          )}
          <Button title="Back to library" secondary onPress={() => router.replace('/')} />
          {job && active && (
            <Button
              title="Cancel generation"
              secondary
              busy={action.busy}
              onPress={() =>
                void action.run(async () => {
                  await controller.api.request(`/generations/${id}`, 'DELETE');
                  rememberGeneration({ ...job, stage: 'cancelled', error: null });
                  await refresh();
                  router.replace('/');
                })
              }
            />
          )}
        </View>
      </ScrollView>
    </Screen>
  );
}
