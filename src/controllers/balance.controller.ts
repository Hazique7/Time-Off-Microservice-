// src/controllers/balance.controller.ts
import { Controller, Get, Post, Body, Param, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { LeaveBalance } from '../entities/leave-balance.entity';
import { TimeOffRequest } from '../entities/time-off-request.entity';
import { HcmStatus } from '../enums/status.enum';
import { StateMachine } from '../utils/state-machine.util';
import { BatchSyncDto } from '../dto/batch-sync.dto';

@Controller('balances')
export class BalanceController {
  constructor(private dataSource: DataSource) {}

  @Get(':employeeId/:locationId')
  async getBalance(@Param('employeeId') employeeId: string, @Param('locationId') locationId: string) {
    const balanceRecord = await this.dataSource.manager.findOne(LeaveBalance, {
      where: { employeeId, locationId }
    });
    if (!balanceRecord) throw new NotFoundException('Balance not found');
    
    return {
      employeeId: balanceRecord.employeeId,
      locationId: balanceRecord.locationId,
      liveBalance: balanceRecord.balance,
      lastSyncedAt: balanceRecord.lastSyncedAt
    };
  }

  // TRD Requirement: Batch Sync Webhook
  @Post('sync/batch')
  async batchSync(@Body() dto: BatchSyncDto) {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    
    // TRD Rule: Wrap the entire batch in a single transaction
    await queryRunner.startTransaction();

    try {
      for (const item of dto.balances) {
        // 1. Find all PENDING requests for this employee
        const pendingRequests = await queryRunner.manager.find(TimeOffRequest, {
          where: {
            employeeId: item.employeeId,
            locationId: item.locationId,
            status: HcmStatus.PENDING
          }
        });

        // 2. TRD Conflict Resolution: Auto-reject if they exceed the new HCM truth
        for (const req of pendingRequests) {
          if (req.days > item.balance) {
            StateMachine.assertValidTransition(req.status, HcmStatus.REJECTED);
            req.status = HcmStatus.REJECTED;
            await queryRunner.manager.save(req);
            console.log(`[Batch Sync] Auto-rejected pending request ${req.id} due to insufficient new balance.`);
          }
        }

        // 3. Upsert the new authoritative balance from the HCM
        let balanceRecord = await queryRunner.manager.findOne(LeaveBalance, {
          where: { employeeId: item.employeeId, locationId: item.locationId }
        });

        if (!balanceRecord) {
          balanceRecord = queryRunner.manager.create(LeaveBalance, {
            employeeId: item.employeeId,
            locationId: item.locationId,
          });
        }

        balanceRecord.balance = item.balance;
        balanceRecord.lastSyncedAt = new Date(); // TRD Rule: Reset staleness clock
        
        await queryRunner.manager.save(balanceRecord);
      }

      await queryRunner.commitTransaction();
      return { success: true, message: 'Batch sync processed successfully' };

    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }
}