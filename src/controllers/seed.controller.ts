// src/controllers/seed.controller.ts
import { Controller, Post } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Employee } from '../entities/employee.entity';
import { LeaveBalance } from '../entities/leave-balance.entity';

@Controller('seed')
export class SeedController {
  constructor(private dataSource: DataSource) {}

  @Post()
  async seedDatabase() {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    
    try {
      // 1. Create a Dummy Employee
      const employee = queryRunner.manager.create(Employee, {
        name: 'Jane Doe',
        locationId: 'US-NYC'
      });
      const savedEmployee = await queryRunner.manager.save(employee);

      // 2. Give Jane 10 days of Leave Balance
      const balance = queryRunner.manager.create(LeaveBalance, {
        employeeId: savedEmployee.id,
        locationId: savedEmployee.locationId,
        balance: 10.0,
      });
      await queryRunner.manager.save(balance);

      return {
        message: 'Database Seeded Successfully!',
        employeeId: savedEmployee.id,
        locationId: savedEmployee.locationId,
        startingBalance: 10.0
      };
    } finally {
      await queryRunner.release();
    }
  }
}