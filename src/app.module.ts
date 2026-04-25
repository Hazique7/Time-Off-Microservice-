// src/app.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HttpModule } from '@nestjs/axios';
import { Employee } from './entities/employee.entity';
import { LeaveBalance } from './entities/leave-balance.entity';
import { TimeOffRequest } from './entities/time-off-request.entity';
import { TimeOffController } from './controllers/time-off.controller';
import { MockHcmController } from './controllers/mock-hcm.controller';
import { TimeOffService } from './services/time-off.service';
import { SeedController } from './controllers/seed.controller';
import { BalanceController } from './controllers/balance.controller';
@Module({
  imports: [
    HttpModule, // Needed for Axios calls
    TypeOrmModule.forRoot({
      type: 'sqlite',
      database: 'exampleHR.sqlite',
      entities: [Employee, LeaveBalance, TimeOffRequest],
      synchronize: true,
    }),
    TypeOrmModule.forFeature([Employee, LeaveBalance, TimeOffRequest]),
  ],
  controllers: [TimeOffController, MockHcmController, SeedController, BalanceController],
  providers: [TimeOffService],
})
export class AppModule {}