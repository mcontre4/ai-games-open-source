import React from 'react';
import { View, Text, ScrollView, Pressable, KeyboardAvoidingView, Platform } from 'react-native';
import { router } from 'expo-router';
import { useApp, useAction } from './provider';
import { Screen, Heading, Field, Button, ErrorText, colors, s } from './ui';
import type { GameView, GenerationSpeed } from '../../../../packages/domain/src/index';
import { GameViewSelector } from './GameViewSelector';
import { GenerationSpeedSelector } from './GenerationSpeedSelector';

import { CreditSummary } from './CreditSummary';
export function CreateScreen({ gameId }: { gameId?: string }) {
  const { controller, state, account, isGuest, rememberGeneration, refresh } = useApp();
  const [prompt, setPrompt] = React.useState('');
  const [orientation, setOrientation] = React.useState<'portrait' | 'landscape'>('portrait');
  const [view, setView] = React.useState<GameView>('2d');
  const [speed, setSpeed] = React.useState<GenerationSpeed>('regular');
  const [age, setAge] = React.useState(false);
  const action = useAction();
  return (
    <Screen>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView keyboardShouldPersistTaps="handled">
          <Heading
            eyebrow={gameId ? 'A NEW CHAPTER' : 'FROM IDEA TO PLAY'}
            title={gameId ? 'Make it\nyour own.' : 'Your imagination.\nNow playable.'}
            description={
              gameId
                ? 'Describe what you want to change. Your previous version stays available.'
                : 'Describe a world, a character, a challenge—and any art or animation style you want. We’ll build the game around your idea.'
            }
          />
          <View style={s.body}>
            {!gameId && <GameViewSelector value={view} onChange={setView} />}

            {account !== 'guest' && <CreditSummary credits={state.credits} />}
            <GenerationSpeedSelector value={speed} onChange={setSpeed} />
            <Text style={s.label}>{gameId ? 'YOUR MODIFICATION' : 'YOUR GAME IDEA'}</Text>
            <Field
              testID="game-prompt"
              accessibilityLabel="Describe your game"
              multiline
              placeholder={
                gameId
                  ? 'Add a new level with flying enemies…'
                  : 'A cozy forest puzzle game in watercolor, with warm autumn colors and softly animated animals…'
              }
              value={prompt}
              onChangeText={setPrompt}
              maxLength={4000}
            />
            <Text style={[s.small, { alignSelf: 'flex-end' }]}>{prompt.length}/4000</Text>
            <Text style={s.small}>
              Ideas are checked before creation. Ordinary game combat is welcome. Explicit sexual
              content, extreme gore, hate, real-money payments and external connections are not
              allowed.
            </Text>
            {!gameId && (
              <View
                accessibilityRole="radiogroup"
                accessibilityLabel="Screen orientation"
                style={{ flexDirection: 'row', gap: 10 }}
              >
                {(['portrait', 'landscape'] as const).map((value) => (
                  <Pressable
                    key={value}
                    accessibilityRole="radio"
                    accessibilityLabel={value.charAt(0).toUpperCase() + value.slice(1)}
                    accessibilityState={{ checked: orientation === value }}
                    aria-checked={orientation === value}
                    onPress={() => setOrientation(value)}
                    style={{
                      paddingHorizontal: 18,
                      paddingVertical: 12,
                      borderRadius: 15,
                      backgroundColor: orientation === value ? colors.mint : colors.surface,
                    }}
                  >
                    <Text
                      style={{
                        color: orientation === value ? colors.bg : colors.muted,
                        fontWeight: '700',
                      }}
                    >
                      {value.charAt(0).toUpperCase() + value.slice(1)}
                    </Text>
                  </Pressable>
                ))}
              </View>
            )}
            <ErrorText message={action.error} />
            {isGuest && (
              <Pressable
                accessibilityRole="checkbox"
                accessibilityLabel="I’m 16 or older"
                accessibilityState={{ checked: age }}
                onPress={() => setAge(!age)}
                style={{ flexDirection: 'row', gap: 12, paddingVertical: 12 }}
              >
                <Text style={s.link}>{age ? '☑' : '□'}</Text>
                <Text style={s.small}>I’m 16 or older and agree to the privacy policy.</Text>
              </Pressable>
            )}
            <Button
              title={gameId ? 'Create new version' : 'Create my game'}
              icon="sparkles-outline"
              busy={action.busy}
              disabled={
                prompt.length < 12 ||
                !state.aiAvailable ||
                (isGuest && !age) ||
                (account !== 'guest' &&
                  (!state.credits ||
                    (state.credits.enabled !== false && state.credits.available <= 0)))
              }
              onPress={() =>
                void action.run(async () => {
                  const job = await controller.create(
                    prompt,
                    orientation,
                    gameId,
                    view,
                    age,
                    speed,
                  );
                  rememberGeneration(job.generation);
                  void refresh();
                  router.push({ pathname: '/generation/[id]', params: { id: job.generationId } });
                })
              }
            />
            {isGuest && (
              <Text style={s.small}>
                Create without an account. Sign up or sign in on this device to keep your games in
                your account.
              </Text>
            )}
            <Text style={s.small}>
              {state.aiAvailable
                ? state.credits?.enabled === false
                  ? 'Creating and updating games won’t use credits for now. Up to 5 new games and 5 modifications each day. Set a theme and style in your prompt, or let us choose one for your game.'
                  : 'AI costs are deducted from your daily credits, including usage before a failed or cancelled generation. Up to 5 new games and 5 modifications each day. Set a theme and style in your prompt, or let us choose one for your game.'
                : 'AI creation is not configured yet. Add the OpenRouter key on the backend to enable it. The bundled sample is ready to play.'}
            </Text>
            <View
              style={{ paddingTop: 25, marginTop: 15, borderTopWidth: 1, borderColor: colors.line }}
            >
              <Text
                style={{ color: colors.text, fontSize: 19, fontWeight: '700', marginBottom: 12 }}
              >
                A spark to get you started
              </Text>
              {(gameId || view === '2d'
                ? [
                    'A cozy moon-garden puzzle game in soft watercolor with gently swaying flowers',
                    'A playful clay-style game about a fox racing through an autumn forest',
                    'A crisp pixel-art adventure where a tiny dragon learns to fly',
                  ]
                : view === '3d'
                  ? [
                      'A playful 3D runner collecting coins through a colorful city, with swipes to dodge obstacles',
                      'A cozy 3D adventure exploring a forest as a fox, with warm autumn colors',
                      'A 3D space flight game weaving between asteroids with smooth touch controls',
                    ]
                  : [
                      'A 3D isometric island adventure collecting gems and exploring tiny villages',
                      'A cozy isometric garden puzzle with sculpted flowers and winding stone paths',
                      'A 3D isometric maze where a tiny dragon finds its way home',
                    ]
              ).map((text) => (
                <Pressable key={text} onPress={() => setPrompt(text)} style={s.row}>
                  <Text style={[s.small, { maxWidth: '88%' }]}>{text}</Text>
                  <Text style={s.link}>↗</Text>
                </Pressable>
              ))}
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}
