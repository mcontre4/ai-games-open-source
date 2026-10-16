import { Text, View } from 'react-native';
import type { CreditBalance } from '../../../../packages/domain/src/credits.ts';
import { colors, s } from './ui';

export function CreditSummary({ credits }: { credits: CreditBalance | null | undefined }) {
  if (credits?.enabled === false)
    return (
      <Text testID="credit-balance" style={s.small}>
        Credit charging is paused.
      </Text>
    );
  return (
    <View style={{ padding: 16, gap: 8, borderRadius: 15, backgroundColor: colors.surface }}>
      <Text style={s.label}>DAILY CREDITS</Text>
      <Text testID="credit-balance" style={{ color: colors.text, fontSize: 22, fontWeight: '700' }}>
        {credits
          ? `${credits.available.toLocaleString(undefined, { maximumFractionDigits: 6 })} credits available`
          : 'Balance unavailable'}
      </Text>
      <Text style={s.small}>
        15 free credits every day. 1 credit = $1 of AI usage. Creating and updating games uses
        credits. Unused credits expire at midnight UTC.
      </Text>
      {credits ? (
        <>
          <Text style={s.small}>
            Resets {new Date(credits.resetsAt).toLocaleString()} (your local time).
          </Text>
          {credits.held > 0 && (
            <Text style={s.small}>
              {credits.held.toLocaleString(undefined, { maximumFractionDigits: 6 })} credits held
              for generation. Unused credits are released when it finishes or stops.
            </Text>
          )}
          {credits.available === 0 && (
            <Text style={s.small}>
              {credits.held > 0
                ? 'Credits are reserved for your current generation.'
                : 'Daily credits used. You can create again after the reset.'}
            </Text>
          )}
        </>
      ) : (
        <Text style={s.small}>Connect to refresh your credit balance.</Text>
      )}
    </View>
  );
}
