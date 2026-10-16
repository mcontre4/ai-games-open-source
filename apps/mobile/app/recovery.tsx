import { captureMobile } from '../src/adapters/analytics';
import React from 'react';
import { View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { supabase } from '../src/adapters/auth';
import { Screen, Heading, Field, Button, ErrorText, s } from '../src/presentation/ui';
import { useAction } from '../src/presentation/provider';
export default function Recovery() {
  const params = useLocalSearchParams<{
    code?: string;
    access_token?: string;
    refresh_token?: string;
  }>();
  const [password, setPassword] = React.useState('');
  const action = useAction();
  React.useEffect(() => {
    void action.run(async () => {
      if (params.code) {
        const { error } = await supabase.auth.exchangeCodeForSession(params.code);
        if (error) throw error;
      } else if (params.access_token && params.refresh_token) {
        const { error } = await supabase.auth.setSession({
          access_token: params.access_token,
          refresh_token: params.refresh_token,
        });
        if (error) throw error;
      }
    });
  }, [params.code, params.access_token, params.refresh_token]);
  return (
    <Screen>
      <Heading eyebrow="ACCOUNT RECOVERY" title="A fresh start." />
      <View style={s.body}>
        <Field
          value={password}
          onChangeText={setPassword}
          placeholder="New password"
          secureTextEntry
        />
        <ErrorText message={action.error} />
        <Button
          title="Update password"
          busy={action.busy}
          disabled={password.length < 8}
          onPress={() =>
            void action.run(async () => {
              const { error } = await supabase.auth.updateUser({ password });
              if (error) throw error;
              captureMobile('account_password_updated');
              router.replace('/');
            })
          }
        />
      </View>
    </Screen>
  );
}
