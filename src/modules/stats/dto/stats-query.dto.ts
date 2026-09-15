import { Transform } from 'class-transformer';
import { ArrayMaxSize, ArrayNotEmpty, IsArray, IsOptional, IsIn, IsString, Matches, MaxLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class StatsQueryDto {
  // The Nest swagger CLI plugin is not enabled for this project, so a class-validator decorator alone
  // publishes nothing: without @ApiPropertyOptional the operation ships `parameters: []` and the window
  // selector is invisible to every client reading the contract.
  @ApiPropertyOptional({
    description: 'Time window for the returned series.',
    enum: ['24h', '7d', '30d'],
    default: '24h',
  })
  @IsOptional()
  @IsIn(['24h', '7d', '30d'])
  period?: '24h' | '7d' | '30d' = '24h';

  @ApiPropertyOptional({
    description: 'Limit every returned metric to one WhatsApp group chat.',
    example: '120363000000000000@g.us',
    maxLength: 255,
    pattern: '^[^@\\s]+@g\\.us$',
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  @Matches(/^[^@\s]+@g\.us$/)
  groupId?: string;

  @ApiPropertyOptional({
    description:
      'Limit every returned metric to multiple WhatsApp group chats. Repeat the query parameter for each group.',
    type: [String],
    minItems: 1,
    maxItems: 200,
    example: ['120363000000000000@g.us', '120363000000000001@g.us'],
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => (Array.isArray(value) ? (value as unknown[]) : [value]))
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(200)
  @IsString({ each: true })
  @MaxLength(255, { each: true })
  @Matches(/^[^@\s]+@g\.us$/, { each: true })
  groupIds?: string[];
}
