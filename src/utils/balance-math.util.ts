// src/utils/balance-math.util.ts
export class BalanceMath {
  // Convert decimals to integer half-days (e.g., 2.5 days -> 5 half-days)
  private static toHalfDays(days: number): number {
    return Math.round(days * 2);
  }

  // Convert back to standard days (e.g., 5 half-days -> 2.5 days)
  private static toDays(halfDays: number): number {
    return halfDays / 2;
  }

  public static deduct(balance: number, requestedDays: number): number {
    const balHalf = this.toHalfDays(balance);
    const reqHalf = this.toHalfDays(requestedDays);
    return this.toDays(balHalf - reqHalf);
  }

  public static refund(balance: number, refundedDays: number): number {
    const balHalf = this.toHalfDays(balance);
    const refHalf = this.toHalfDays(refundedDays);
    return this.toDays(balHalf + refHalf);
  }
}