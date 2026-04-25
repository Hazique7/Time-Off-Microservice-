// src/utils/balance-math.util.spec.ts
import { BalanceMath } from './balance-math.util';

describe('BalanceMath Utility', () => {
  it('should accurately deduct days using integer conversion', () => {
    const result = BalanceMath.deduct(10.0, 2.5);
    expect(result).toBe(7.5);
  });

  it('should accurately refund days using integer conversion', () => {
    const result = BalanceMath.refund(7.5, 2.5);
    expect(result).toBe(10.0);
  });

  it('should handle complex floating-point scenarios without drift', () => {
    // In normal JS, 0.1 + 0.2 = 0.30000000000000004
    // We simulate a weird floating point input to ensure our math forces it to a clean half-day integer.
    const result = BalanceMath.deduct(5.0, 1.50000000000001);
    expect(result).toBe(3.5); 
  });
});