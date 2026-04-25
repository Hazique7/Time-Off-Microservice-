// src/utils/state-machine.util.ts
import { UnprocessableEntityException } from '@nestjs/common';
import { HcmStatus } from '../enums/status.enum';

export class StateMachine {
  private static validTransitions: Record<HcmStatus | 'NONE', HcmStatus[]> = {
    'NONE': [HcmStatus.PENDING],
    [HcmStatus.PENDING]: [HcmStatus.APPROVED, HcmStatus.REJECTED, HcmStatus.CANCELLED],
    [HcmStatus.APPROVED]: [HcmStatus.CANCELLED],
    [HcmStatus.REJECTED]: [],
    [HcmStatus.CANCELLED]: [],
  };

  public static assertValidTransition(from: HcmStatus | 'NONE', to: HcmStatus): void {
    const allowed = this.validTransitions[from] || [];
    if (!allowed.includes(to)) {
      throw new UnprocessableEntityException(`Invalid status transition: ${from} → ${to}`);
    }
  }
}