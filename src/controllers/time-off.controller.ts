// src/controllers/time-off.controller.ts
import { TimeOffService } from '../services/time-off.service';
import { CreateTimeOffDto } from '../dto/create-time-off.dto';
import { Controller, Post, Body, Patch, Param } from '@nestjs/common';
@Controller('time-off')
export class TimeOffController {
  constructor(private readonly timeOffService: TimeOffService) {}

  @Post()
  async createTimeOffRequest(@Body() dto: CreateTimeOffDto) {
    // NestJS automatically validates the DTO before this line is even reached!
    return this.timeOffService.createRequest(dto);
  }
  @Patch(':id/cancel')
  async cancelTimeOffRequest(@Param('id') id: string) {
    return this.timeOffService.cancelRequest(id);
  }
}