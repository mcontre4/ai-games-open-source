export const DAILY_CREDITS = 15;

export interface CreditBalance {
  // Older servers omit this field; omission means credits are enabled.
  enabled?: boolean;
  dailyAllowance: number;
  available: number;
  spent: number;
  held: number;
  resetsAt: string;
}

export function creditPeriod(now: string) {
  const date = new Date(now);
  const day = date.toISOString().slice(0, 10);
  date.setUTCHours(24, 0, 0, 0);
  return { day, resetsAt: date.toISOString() };
}

export function creditBalance(
  now: string,
  spent: number,
  held: number,
  bonusAvailable = 0,
): CreditBalance {
  return {
    enabled: true,
    dailyAllowance: DAILY_CREDITS,
    available:
      Math.round((Math.max(0, DAILY_CREDITS - spent - held) + bonusAvailable) * 1_000_000) /
      1_000_000,
    spent,
    held,
    resetsAt: creditPeriod(now).resetsAt,
  };
}
