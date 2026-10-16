import React from 'react';
import { View, Text, Pressable, Switch } from 'react-native';
import { router } from 'expo-router';
import type { AccountProfile, ProfileUpdate } from '../../../../packages/domain/src/profile.ts';
import { useApp, useAction } from './provider';
import { Avatar, avatarIds } from './Avatar';
import { Button, Field, ErrorText, Fade, colors, s } from './ui';
function Preference({
  title,
  detail,
  value,
  onChange,
}: {
  title: string;
  detail: string;
  value: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <View style={[s.row, { gap: 16 }]}>
      <View style={{ flex: 1 }}>
        <Text style={s.rowText}>{title}</Text>
        <Text style={[s.small, { marginTop: 5 }]}>{detail}</Text>
      </View>
      <Switch
        accessibilityLabel={title}
        value={value}
        onValueChange={onChange}
        trackColor={{ true: colors.mint }}
      />
    </View>
  );
}
export function ProfileSettings({ profile }: { profile: AccountProfile }) {
  const { controller, refresh, state } = useApp();
  const action = useAction();
  const [draft, setDraft] = React.useState<ProfileUpdate>(profile);
  const [notice, setNotice] = React.useState('');
  const edit = <K extends keyof ProfileUpdate>(key: K, value: ProfileUpdate[K]) => {
    setDraft((current) => ({ ...current, [key]: value }));
    setNotice('');
  };
  return (
    <Fade>
      <View style={{ gap: 14 }}>
        <View style={{ flexDirection: 'row', gap: 18, alignItems: 'center' }}>
          <Avatar id={draft.avatarId} size={88} />
          <View style={{ flex: 1 }}>
            <Text style={[s.rowText, { fontSize: 22, fontWeight: '800' }]}>
              {draft.displayName || 'Your profile'}
            </Text>
            <Text style={s.link}>@{draft.username}</Text>
          </View>
        </View>
        <Text style={s.label}>CHOOSE YOUR CREATURE</Text>
        <View
          style={{
            flexDirection: 'row',
            flexWrap: 'wrap',
            justifyContent: 'space-between',
            rowGap: 12,
          }}
        >
          {avatarIds.map((id) => (
            <Pressable
              key={id}
              accessibilityRole="radio"
              accessibilityLabel={`Choose ${id}`}
              accessibilityState={{ checked: draft.avatarId === id }}
              aria-checked={draft.avatarId === id}
              onPress={() => edit('avatarId', id)}
              style={({ pressed }) => ({
                width: '18%',
                alignItems: 'center',
                gap: 5,
                paddingVertical: 6,
                borderRadius: 14,
                borderWidth: 2,
                borderColor: draft.avatarId === id ? colors.mint : 'transparent',
                transform: [{ scale: pressed ? 0.94 : 1 }],
              })}
            >
              <Avatar id={id} size={48} />
              <Text
                style={{
                  color: draft.avatarId === id ? colors.mint : colors.muted,
                  fontSize: 10,
                  textTransform: 'capitalize',
                }}
              >
                {id}
              </Text>
            </Pressable>
          ))}
        </View>
        <Text style={s.label}>PROFILE</Text>
        <Text style={s.rowText}>Username</Text>
        <Field
          accessibilityLabel="Username"
          testID="profile-username"
          returnKeyType="done"
          value={draft.username}
          onChangeText={(v) => edit('username', v)}
          autoCapitalize="none"
          autoCorrect={false}
          maxLength={25}
        />
        <Text style={s.small}>4–25 letters, numbers or underscores. Your username is unique.</Text>
        <Text style={s.rowText}>Display name</Text>
        <Field
          accessibilityLabel="Display name"
          testID="profile-display-name"
          returnKeyType="done"
          value={draft.displayName}
          onChangeText={(v) => edit('displayName', v)}
          maxLength={40}
        />
        <Text style={s.rowText}>Bio</Text>
        <Field
          accessibilityLabel="Bio"
          placeholder="A little about you and what you make"
          value={draft.bio}
          onChangeText={(v) => edit('bio', v)}
          maxLength={280}
          multiline
          style={{ height: 110 }}
        />
        <Text style={s.small}>{draft.bio.length}/280</Text>
        <Text style={s.label}>PRIVACY & SAVES</Text>
        <Preference
          title="Show my creator profile"
          detail="Let signed-in players view your bio and games they can access. Your name and creature still appear on your games."
          value={draft.profileVisible}
          onChange={(v) => edit('profileVisible', v)}
        />
        <Preference
          title="Show me on leaderboards"
          detail="Hide your name and scores from game leaderboards when off. Your scores are still saved."
          value={draft.leaderboardVisible}
          onChange={(v) => edit('leaderboardVisible', v)}
        />
        <Preference
          title="Automatically sync saves"
          detail="Sync when connected. You can always sync manually."
          value={draft.autoSync}
          onChange={(v) => edit('autoSync', v)}
        />
        <ErrorText message={action.error} />
        {!!notice && (
          <Text accessibilityRole="alert" style={s.link}>
            {notice}
          </Text>
        )}
        <Button
          title="Save profile & preferences"
          busy={action.busy}
          disabled={!state.online}
          onPress={() =>
            void action.run(async () => {
              const { id: _id, createdAt: _createdAt, ...input } = draft as AccountProfile;
              const saved = await controller.updateProfile(input);
              setDraft(saved);
              setNotice('Profile and preferences saved.');
              await refresh();
            })
          }
        />
        {!state.online && <Text style={s.small}>Connect to save profile changes.</Text>}
        <Button
          title="View my profile"
          secondary
          onPress={() =>
            router.push({
              pathname: '/profile/[username]',
              params: { username: controller.profile?.username ?? profile.username },
            })
          }
        />
      </View>
    </Fade>
  );
}
