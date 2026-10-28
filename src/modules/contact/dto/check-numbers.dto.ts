import { ApiProperty } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsString, Matches, MaxLength } from 'class-validator';

export const BULK_NUMBER_CHECK_MAX = 100;

export class CheckNumbersDto {
  @ApiProperty({
    description:
      'Phone numbers with country code. A leading + is accepted and removed before lookup. ' +
      'Duplicates are checked once, preserving first-seen order.',
    example: ['919876543210', '919876543211'],
    type: [String],
    minItems: 1,
    maxItems: BULK_NUMBER_CHECK_MAX,
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(BULK_NUMBER_CHECK_MAX)
  @IsString({ each: true })
  @MaxLength(16, { each: true })
  @Matches(/^\+?\d{5,15}$/, {
    each: true,
    message: 'each number must contain 5 to 15 digits with an optional leading +',
  })
  numbers!: string[];
}
