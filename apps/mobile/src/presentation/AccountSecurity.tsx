import React from 'react';
import { View, Text } from 'react-native';
import { useApp, useAction } from './provider';
import { Field, Button, ErrorText, s } from './ui';
export function AccountSecurity() {
  const { controller, state } = useApp();
  const action = useAction();
  const [currentPassword, setCurrentPassword] = React.useState('');
  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [notice, setNotice] = React.useState('');
  return (
    <View style={{ gap: 14 }}>
      <Text style={s.label}>ACCOUNT SECURITY</Text>
      <Text style={s.small}>
        Signed in as {controller.email}. Enter your current password to change your email or
        password.
      </Text>
      <Field
        accessibilityLabel="Current password"
        placeholder="Current password"
        value={currentPassword}
        onChangeText={setCurrentPassword}
        secureTextEntry
        autoComplete="current-password"
        autoCapitalize="none"
      />
      <Field
        accessibilityLabel="New email"
        placeholder="New email address"
        value={email}
        onChangeText={setEmail}
        keyboardType="email-address"
        autoCapitalize="none"
        autoComplete="email"
      />
      <Button
        title="Change email"
        secondary
        busy={action.busy}
        disabled={!state.online || !currentPassword || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)}
        onPress={() =>
          void action.run(async () => {
            setNotice('');
            await controller.changeCredentials(currentPassword, { email: email.trim() });
            setCurrentPassword('');
            setEmail('');
            setNotice('Check your inbox to confirm your email change.');
          })
        }
      />
      <Field
        accessibilityLabel="New password"
        placeholder="New password (at least 8 characters)"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        autoComplete="new-password"
        autoCapitalize="none"
      />
      <Button
        title="Change password"
        secondary
        busy={action.busy}
        disabled={!state.online || !currentPassword || password.length < 8}
        onPress={() =>
          void action.run(async () => {
            setNotice('');
            await controller.changeCredentials(currentPassword, { password });
            setCurrentPassword('');
            setPassword('');
            setNotice('Password updated.');
          })
        }
      />
      <ErrorText message={action.error} />
      {!!notice && (
        <Text accessibilityRole="alert" style={s.small}>
          {notice}
        </Text>
      )}
    </View>
  );
}
