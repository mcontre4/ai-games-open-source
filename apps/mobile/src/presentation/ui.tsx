import React from 'react';
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  TextInput,
  ActivityIndicator,
  type TextInputProps,
  Animated,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { colors, motion } from '../../../../packages/ui/src/index.ts';
export { colors };
export function Screen({ children }: { children: React.ReactNode }) {
  return (
    <SafeAreaView style={s.screen} edges={['top', 'left', 'right']}>
      {children}
    </SafeAreaView>
  );
}
export function Heading({
  eyebrow,
  title,
  description,
}: {
  eyebrow: string;
  title: string;
  description?: string;
}) {
  return (
    <View style={s.heading}>
      <Text style={s.eyebrow}>{eyebrow}</Text>
      <Text style={s.title}>{title}</Text>
      {description && <Text style={s.description}>{description}</Text>}
    </View>
  );
}
export function Button({
  title,
  onPress,
  busy = false,
  secondary = false,
  disabled = false,
  testID,
  accessibilityLabel,
  icon,
}: {
  title: string;
  onPress: () => void;
  busy?: boolean;
  secondary?: boolean;
  disabled?: boolean;
  testID?: string;
  accessibilityLabel?: string;
  icon?: React.ComponentProps<typeof Ionicons>['name'];
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? title}
      testID={testID}
      onPress={onPress}
      disabled={disabled || busy}
      style={({ pressed }) => [
        s.button,
        secondary && s.secondary,
        (disabled || busy) && { opacity: 0.45 },
        pressed && { transform: [{ scale: motion.pressScale }], opacity: 0.8 },
      ]}
    >
      {busy ? (
        <ActivityIndicator color={secondary ? colors.mint : colors.bg} />
      ) : (
        <>
          <Text style={[s.buttonText, secondary && { color: colors.text }]}>{title}</Text>
          {icon && <Ionicons name={icon} size={21} color={secondary ? colors.text : colors.bg} />}
        </>
      )}
    </Pressable>
  );
}
export function Field(props: TextInputProps) {
  return (
    <TextInput
      placeholderTextColor={colors.muted}
      {...props}
      style={[s.input, props.multiline && s.multiline, props.style]}
    />
  );
}
export function ErrorText({ message }: { message: string | null | undefined }) {
  return message ? (
    <Text accessibilityRole="alert" style={s.error}>
      {message}
    </Text>
  ) : null;
}
export function Fade({ children }: { children: React.ReactNode }) {
  const opacity = React.useRef(new Animated.Value(0)).current;
  React.useEffect(() => {
    Animated.timing(opacity, {
      toValue: 1,
      duration: motion.entranceMs,
      useNativeDriver: true,
    }).start();
  }, [opacity]);
  return <Animated.View style={{ opacity }}>{children}</Animated.View>;
}
export const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  heading: { padding: 24, paddingTop: 26 },
  eyebrow: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 2.5,
    color: colors.mint,
    marginBottom: 14,
  },
  title: {
    fontSize: 42,
    lineHeight: 45,
    fontWeight: '800',
    letterSpacing: -1.8,
    color: colors.text,
  },
  description: { fontSize: 15, lineHeight: 23, color: colors.muted, marginTop: 12, maxWidth: 340 },
  button: {
    backgroundColor: colors.mint,
    borderRadius: 16,
    paddingHorizontal: 20,
    paddingVertical: 18,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 56,
  },
  buttonText: { fontSize: 15, fontWeight: '800', color: colors.bg },
  secondary: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line },
  input: {
    backgroundColor: colors.surface,
    borderRadius: 15,
    padding: 18,
    fontSize: 16,
    color: colors.text,
    borderWidth: 1,
    borderColor: colors.line,
    minHeight: 58,
  },
  multiline: { height: 190, textAlignVertical: 'top', lineHeight: 26 },
  error: { color: colors.danger, fontSize: 13, lineHeight: 20, marginVertical: 14 },
  body: { paddingHorizontal: 24, gap: 14, paddingBottom: 36 },
  label: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.5,
    marginVertical: 8,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 17,
    borderBottomWidth: 1,
    borderColor: colors.line,
  },
  rowText: { color: colors.text, fontSize: 15 },
  small: { color: colors.muted, fontSize: 13, lineHeight: 20 },
  link: { color: colors.mint, fontSize: 14, fontWeight: '700' },
  back: { padding: 22, flexDirection: 'row', gap: 8, alignItems: 'center' },
});
