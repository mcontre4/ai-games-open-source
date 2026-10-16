import { describe, expect, it, vi } from 'vitest';
import { creditBalance, creditPeriod } from '../../packages/domain/src/credits.ts';
import { GetCreditBalance } from '../../packages/application/src/credits.ts';

describe('daily credits', () => {
  it('uses UTC calendar days across timezone and month boundaries', () => {
    expect(creditPeriod('2026-12-31T16:01:00-08:00')).toEqual({
      day: '2027-01-01',
      resetsAt: '2027-01-02T00:00:00.000Z',
    });
    expect(creditPeriod('2026-10-11T23:59:59.999Z').day).toBe('2026-10-11');
    expect(creditPeriod('2026-10-12T00:00:00.000Z').day).toBe('2026-10-12');
  });
  it('keeps fractional dollar costs, subtracts holds, and clamps exhausted balances', () => {
    expect(creditBalance('2026-10-11T12:00:00Z', 0.000123, 10)).toMatchObject({
      dailyAllowance: 15,
      available: 4.999877,
      spent: 0.000123,
      held: 10,
    });
    expect(creditBalance('2026-10-11T12:00:00Z', 16, 0).available).toBe(0);
  });
  it('passes the authenticated identity and injected time to the repository', async () => {
    const now = '2026-10-12T00:00:00Z';
    const expected = creditBalance(now, 0, 0);
    const credits = { balance: vi.fn().mockResolvedValue(expected) };
    expect(await new GetCreditBalance(credits, { now: () => now }).execute('user-one')).toEqual(
      expected,
    );
    expect(credits.balance).toHaveBeenCalledWith('user-one', now);
  });
});
