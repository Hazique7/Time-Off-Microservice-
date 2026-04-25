// src/controllers/mock-hcm.controller.ts
import { Controller, Post, Body, HttpException, HttpStatus } from '@nestjs/common';
import { Delete, Param } from '@nestjs/common';

@Controller('mock-hcm')
export class MockHcmController {
  
  @Post('time-off')
  simulateHcmEndpoint(@Body() body: { employeeId: string; locationId: string; days: number }) {
    console.log(`[Mock HCM] Received request:`, body);

    // Simulate network delay
    const delay = Math.floor(Math.random() * 1000) + 500; 

    return new Promise((resolve, reject) => {
      setTimeout(() => {
        // 80% chance of approval, 20% chance of random HCM rejection
        const isApproved = Math.random() > 0.2; 

        if (isApproved) {
          resolve({
            success: true,
            hcmRef: `HCM-${Math.floor(Math.random() * 100000)}`,
            message: 'Leave approved in HCM'
          });
        } else {
          reject(new HttpException({
            success: false,
            error: 'HCM_INSUFFICIENT_FUNDS_OR_INVALID_DIMENSIONS'
          }, HttpStatus.BAD_REQUEST));
        }
      }, delay);
    });
  }
  @Delete('time-off/:hcmRef')
  simulateHcmCancellation(@Param('hcmRef') hcmRef: string) {
    console.log(`[Mock HCM] Received cancellation for ref: ${hcmRef}`);

    return new Promise((resolve, reject) => {
      setTimeout(() => {
        // 90% chance of successful cancellation, 10% chance the HCM is down
        const isSuccess = Math.random() > 0.1; 

        if (isSuccess) {
          resolve({ success: true, message: 'Leave cancelled in HCM' });
        } else {
          reject(new HttpException({
            success: false,
            error: 'HCM_UNAVAILABLE'
          }, HttpStatus.BAD_GATEWAY));
        }
      }, 500);
    });
  }
}