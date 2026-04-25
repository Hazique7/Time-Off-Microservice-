
// src/dto/create-time-off.dto.ts
import { IsUUID, IsNumber, Min, IsString, Validate, ValidatorConstraint, ValidatorConstraintInterface } from 'class-validator';

// 1. Create a custom, mathematically safe rule
@ValidatorConstraint({ name: 'isMultipleOfHalf', async: false })
export class IsMultipleOfHalfConstraint implements ValidatorConstraintInterface {
  validate(days: number) {
    // If we multiply by 2, it should be a perfect whole number (e.g., 2.5 * 2 = 5.0)
    return typeof days === 'number' && (days * 2) % 1 === 0;
  }
  defaultMessage() {
    return 'Requested days must be a positive multiple of 0.5';
  }
}

// 2. Apply it to the DTO
export class CreateTimeOffDto {
  @IsUUID()
  employeeId!: string;

  @IsString()
  locationId!: string;

  @IsNumber()
  @Min(0.5)
  @Validate(IsMultipleOfHalfConstraint) // Use our custom rule here!
  days!: number;
}