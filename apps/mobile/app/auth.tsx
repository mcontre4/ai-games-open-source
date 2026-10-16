import { appScheme } from '../src/config/environment';
import { captureMobile } from '../src/adapters/analytics';
import React from 'react';
import { View, Text, ScrollView, Pressable, KeyboardAvoidingView, Platform } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { supabase } from '../src/adapters/auth';
import { useAction, useApp } from '../src/presentation/provider';
import { Screen, Heading, Field, Button, ErrorText, colors, s } from '../src/presentation/ui';
export default function Auth() {
  const params = useLocalSearchParams<{ code?: string }>();
  React.useEffect(() => {
    if (params.code)
      void supabase.auth.exchangeCodeForSession(params.code).then(({ error }) => {
        if (!error) router.replace('/');
      });
  }, [params.code]);
  const [mode, setMode] = React.useState<'signin' | 'signup' | 'recover'>('signin');
  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [name, setName] = React.useState('');
  const [age, setAge] = React.useState(false);
  const [notice, setNotice] = React.useState('');
  const action = useAction();
  const { controller, refresh } = useApp();
  return (
    <Screen>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView keyboardShouldPersistTaps="handled">
          <Pressable onPress={() => router.replace('/')} style={s.back}>
            <Text style={s.link}>← Library</Text>
          </Pressable>
          <Heading
            eyebrow="WELCOME TO YOUR ARCADE"
            title={
              mode === 'signup'
                ? 'An account.\nEndless ideas.'
                : mode === 'recover'
                  ? 'Let’s get\nyou back in.'
                  : 'Good to\nsee you.'
            }
          />
          <View style={s.body}>
            {mode === 'signup' && (
              <Field
                placeholder="Player name"
                accessibilityLabel="Player name"
                value={name}
                onChangeText={setName}
                maxLength={40}
              />
            )}
            <Field
              placeholder="Email address"
              accessibilityLabel="Email address"
              testID="email"
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              autoComplete="email"
            />
            {mode !== 'recover' && (
              <Field
                placeholder="Password"
                accessibilityLabel="Password"
                testID="password"
                value={password}
                onChangeText={setPassword}
                secureTextEntry
                autoCapitalize="none"
                autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
              />
            )}
            <ErrorText message={action.error} />
            {notice && <Text style={s.small}>{notice}</Text>}
            {mode === 'signup' && (
              <Pressable
                accessibilityRole="checkbox"
                accessibilityState={{ checked: age }}
                onPress={() => setAge(!age)}
                style={{ flexDirection: 'row', gap: 12, paddingVertical: 12 }}
              >
                <Text style={s.link}>{age ? '☑' : '□'}</Text>
                <Text style={s.small}>I’m 16 or older and agree to the privacy policy.</Text>
              </Pressable>
            )}
            <Button
              title={
                mode === 'signin'
                  ? 'Sign in'
                  : mode === 'signup'
                    ? 'Create account'
                    : 'Send recovery email'
              }
              testID="submit-auth"
              busy={action.busy}
              disabled={mode === 'signup' && !age}
              onPress={() =>
                void action.run(async () => {
                  if (mode === 'recover') {
                    const { error } = await supabase.auth.resetPasswordForEmail(email, {
                      redirectTo: `${appScheme}://recovery`,
                    });
                    if (error) throw error;
                    captureMobile('account_recovery_requested');
                    setNotice('Check your email for a recovery link.');
                    return;
                  }
                  await controller.linkGuestGames();
                  const result =
                    mode === 'signin'
                      ? await supabase.auth.signInWithPassword({ email, password })
                      : await supabase.auth.signUp({
                          email,
                          password,
                          options: {
                            data: { display_name: name || 'Player', age_confirmed: age },
                            emailRedirectTo: `${appScheme}://auth`,
                          },
                        });
                  if (result.error) {
                    captureMobile('account_auth_failed', { operation: mode });
                    throw result.error;
                  }
                  if (mode === 'signup')
                    captureMobile('account_signup_submitted', { success: true });
                  if (result.data.session) {
                    controller.account = result.data.session.user.id;
                    controller.isGuest = false;
                    await controller.linkGuestGames();
                    await refresh();
                    router.replace('/');
                  } else setNotice('Check your email to confirm your account, then sign in.');
                })
              }
            />
            <Pressable
              onPress={() => {
                setMode(mode === 'signup' ? 'signin' : 'signup');
                setNotice('');
                action.setError(null);
              }}
              style={{ paddingVertical: 12 }}
            >
              <Text style={s.link}>
                {mode === 'signup'
                  ? 'Already have an account? Sign in'
                  : 'New here? Create an account'}
              </Text>
            </Pressable>
            <Pressable onPress={() => setMode('recover')}>
              <Text style={s.small}>Forgot your password?</Text>
            </Pressable>
            <Text style={{ color: colors.muted, fontSize: 11, lineHeight: 18, marginTop: 25 }}>
              Your saves are private to your account. Games get no access to your email, device
              files, camera or microphone.
            </Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}
