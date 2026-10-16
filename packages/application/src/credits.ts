import type { ClockPort, CreditRepository } from './ports.ts';

export class GetCreditBalance {
  constructor(
    private credits: CreditRepository,
    private clock: ClockPort,
  ) {}
  execute(userId: string) {
    return this.credits.balance(userId, this.clock.now());
  }
}
