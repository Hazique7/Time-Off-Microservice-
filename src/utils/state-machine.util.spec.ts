// src/utils/state-machine.util.spec.ts
import { StateMachine } from './state-machine.util';
import { HcmStatus } from '../enums/status.enum';
import { UnprocessableEntityException } from '@nestjs/common';

describe('StateMachine Utility', () => {
  it('should allow valid status transitions', () => {
    // Expecting these NOT to throw an error
    expect(() => StateMachine.assertValidTransition('NONE', HcmStatus.PENDING)).not.toThrow();
    expect(() => StateMachine.assertValidTransition(HcmStatus.PENDING, HcmStatus.APPROVED)).not.toThrow();
    expect(() => StateMachine.assertValidTransition(HcmStatus.APPROVED, HcmStatus.CANCELLED)).not.toThrow();
  });

  it('should completely block invalid status transitions', () => {
    // You cannot jump from APPROVED directly to REJECTED
    expect(() => StateMachine.assertValidTransition(HcmStatus.APPROVED, HcmStatus.REJECTED))
      .toThrow(UnprocessableEntityException);

    // You cannot cancel something that is already cancelled
    expect(() => StateMachine.assertValidTransition(HcmStatus.CANCELLED, HcmStatus.CANCELLED))
      .toThrow(UnprocessableEntityException);
  });
});