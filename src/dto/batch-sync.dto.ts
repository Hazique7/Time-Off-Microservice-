// src/dto/batch-sync.dto.ts
import { IsArray, ValidateNested, IsUUID, IsNumber, IsString } from 'class-validator';
import { Type } from 'class-transformer';

export class BatchBalanceItemDto {
  @IsUUID() 
  employeeId!: string;

  @IsString() 
  locationId!: string;

  @IsNumber() 
  balance!: number;
}

export class BatchSyncDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BatchBalanceItemDto)
  balances!: BatchBalanceItemDto[];
}