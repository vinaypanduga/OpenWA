import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsInt,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { MessageStatsResponseDto } from './stats-response.dto';

export const GROUP_ANALYTICS_MAX_GROUPS = 200;
export const GROUP_ANALYTICS_MAX_DAYS = 90;

export class GroupAnalyticsRequestDto {
  @ApiProperty({
    description: 'WhatsApp group IDs to include. Each ID must end in @g.us.',
    type: [String],
    minItems: 1,
    maxItems: GROUP_ANALYTICS_MAX_GROUPS,
    example: ['120363000000000001@g.us', '120363000000000002@g.us'],
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(GROUP_ANALYTICS_MAX_GROUPS)
  @ArrayUnique()
  @IsString({ each: true })
  @MaxLength(255, { each: true })
  @Matches(/^[^@\s]+@g\.us$/, { each: true })
  groupIds!: string[];

  @ApiProperty({
    description: 'Rolling number of 24-hour days to include, ending when the request is processed.',
    minimum: 1,
    maximum: GROUP_ANALYTICS_MAX_DAYS,
    default: 7,
    example: 7,
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(GROUP_ANALYTICS_MAX_DAYS)
  days!: number;
}

export class GroupAnalyticsResponseDto {
  @ApiProperty({ description: 'Inclusive start of the rolling analytics window.', format: 'date-time' })
  windowStart!: string;

  @ApiProperty({ description: 'Exclusive end of the rolling analytics window.', format: 'date-time' })
  windowEnd!: string;

  @ApiProperty({ example: 7 })
  days!: number;

  @ApiProperty({ type: [String], example: ['120363000000000001@g.us', '120363000000000002@g.us'] })
  groupIds!: string[];

  @ApiProperty({
    type: MessageStatsResponseDto,
    description:
      'Combined and per-group analytics. All fields are limited to the requested session, groups, and date window.',
  })
  analytics!: MessageStatsResponseDto;
}
