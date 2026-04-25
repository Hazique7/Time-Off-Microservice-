// src/services/time-off.service.ts
import { BadGatewayException } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { Injectable, UnprocessableEntityException, InternalServerErrorException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { LeaveBalance } from '../entities/leave-balance.entity';
import { TimeOffRequest } from '../entities/time-off-request.entity';
import { CreateTimeOffDto } from '../dto/create-time-off.dto';
import { HcmStatus } from '../enums/status.enum';
import { BalanceMath } from '../utils/balance-math.util';
import { StateMachine } from '../utils/state-machine.util';

@Injectable()
export class TimeOffService {
  // BUG 1 FIXED: Injected HttpService into the constructor
  constructor(
    private dataSource: DataSource,
    private readonly httpService: HttpService
  ) {}

  async createRequest(dto: CreateTimeOffDto): Promise<TimeOffRequest> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    let savedRequest: TimeOffRequest;

    try {
      // 1. Acquire row-level lock
      const balanceRecord = await queryRunner.manager
        .createQueryBuilder(LeaveBalance, 'lb')
        .where('lb.employeeId = :employeeId', { employeeId: dto.employeeId })
        .andWhere('lb.locationId = :locationId', { locationId: dto.locationId })
        .getOne();

      if (!balanceRecord) {
        throw new UnprocessableEntityException('Balance record not found');
      }

      // 2. Pre-flight Validation
      if (balanceRecord.balance < dto.days) {
        throw new UnprocessableEntityException('Insufficient leave balance');
      }

      // 3. Deduct tentatively using Integer Math
      balanceRecord.balance = BalanceMath.deduct(balanceRecord.balance, dto.days);
      await queryRunner.manager.save(balanceRecord);

      // 4. Create PENDING request
      StateMachine.assertValidTransition('NONE', HcmStatus.PENDING);
      
      const newRequest = queryRunner.manager.create(TimeOffRequest, {
        employeeId: dto.employeeId,
        locationId: dto.locationId,
        days: dto.days,
        status: HcmStatus.PENDING,
      });
      
      savedRequest = await queryRunner.manager.save(newRequest);

      // 5. Commit & Release Lock BEFORE network call
      await queryRunner.commitTransaction();
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }

    // BUG 2 & 3 FIXED: Added the missing call, the return statement, and closed the method!
    // 6. Network Call to HCM (Out of DB Transaction)
    await this.callHcmAndFinalize(savedRequest.id);

   // 7. Re-fetch the fully updated request so Postman sees the final state
    const finalRequest = await this.dataSource.manager.findOne(TimeOffRequest, {
      where: { id: savedRequest.id }
    });

    return finalRequest!;
  }

  // Now this is safely its own separate method
  private async callHcmAndFinalize(requestId: string): Promise<void> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();

    try {
      // 1. Fetch the pending request
      const request = await queryRunner.manager.findOne(TimeOffRequest, {
        where: { id: requestId }
      });

      if (!request || request.status !== HcmStatus.PENDING) return;

      console.log(`[HCM Sync] Calling external HCM for request ${requestId}...`);

      // 2. Make the HTTP Call (Replace localhost with actual HCM URL in prod)
      const response = await firstValueFrom(
        this.httpService.post('http://localhost:3000/mock-hcm/time-off', {
          employeeId: request.employeeId,
          locationId: request.locationId,
          days: request.days
        })
      );

      // 3. HCM Success Path (Atomic Status Update)
      await queryRunner.startTransaction();
      StateMachine.assertValidTransition(request.status, HcmStatus.APPROVED);
      request.status = HcmStatus.APPROVED;
      request.hcmRef = response.data.hcmRef;
      await queryRunner.manager.save(request);
      await queryRunner.commitTransaction();

      console.log(`[HCM Sync] Success! hcmRef: ${request.hcmRef}`);

    } catch (error) {
      // 4. HCM Rejection Path (Atomic Refund & Status Update)
      console.log(`[HCM Sync] Failed. Refunding balance...`);
      await queryRunner.startTransaction();

      const requestToFail = await queryRunner.manager.findOne(TimeOffRequest, { where: { id: requestId } });
      const balanceToRefund = await queryRunner.manager.findOne(LeaveBalance, {
        where: { employeeId: requestToFail!.employeeId, locationId: requestToFail!.locationId }
      });

      if (requestToFail && balanceToRefund) {
        // Refund integer math
        balanceToRefund.balance = BalanceMath.refund(balanceToRefund.balance, requestToFail.days);
        
        StateMachine.assertValidTransition(requestToFail.status, HcmStatus.REJECTED);
        requestToFail.status = HcmStatus.REJECTED;

        await queryRunner.manager.save(balanceToRefund);
        await queryRunner.manager.save(requestToFail);
        await queryRunner.commitTransaction();
      }
    } finally {
      await queryRunner.release();
    }
  }
  async cancelRequest(requestId: string): Promise<TimeOffRequest> {
    // 1. Fetch the request to check its current status
    const request = await this.dataSource.manager.findOne(TimeOffRequest, {
      where: { id: requestId }
    });

    if (!request) {
      throw new UnprocessableEntityException('Request not found');
    }

    if (request.status === HcmStatus.REJECTED || request.status === HcmStatus.CANCELLED) {
      throw new UnprocessableEntityException(`Cannot cancel a request that is already ${request.status}`);
    }

    // 2. If APPROVED, we MUST notify the HCM first!
    if (request.status === HcmStatus.APPROVED) {
      console.log(`[HCM Sync] Attempting to cancel ref ${request.hcmRef} in HCM...`);
      try {
        await firstValueFrom(
          this.httpService.delete(`http://localhost:3000/mock-hcm/time-off/${request.hcmRef}`)
        );
        console.log(`[HCM Sync] Cancellation confirmed by HCM.`);
      } catch (error) {
        console.error(`[HCM Sync] HCM Cancellation failed. Aborting local refund.`);
        // TRD Rule: Return HTTP 502 and do NOT refund or change status
        throw new BadGatewayException('HCM could not process cancellation. Try again later.');
      }
    }

    // 3. If HCM succeeded (or if it was PENDING), do the local atomic refund
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const balanceToRefund = await queryRunner.manager.findOne(LeaveBalance, {
        where: { employeeId: request.employeeId, locationId: request.locationId }
      });

      if (!balanceToRefund) throw new UnprocessableEntityException('Balance not found');

      // Integer math refund
      balanceToRefund.balance = BalanceMath.refund(balanceToRefund.balance, request.days);
      
      StateMachine.assertValidTransition(request.status, HcmStatus.CANCELLED);
      request.status = HcmStatus.CANCELLED;

      await queryRunner.manager.save(balanceToRefund);
      const cancelledRequest = await queryRunner.manager.save(request);
      
      await queryRunner.commitTransaction();
      return cancelledRequest;

    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }
}