import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { CustomGroupSource } from '../entities/custom-group.entity';

const NAME_MAX_LENGTH = 100;
const MAX_GROUPS = 1000;
const SOURCE_VALUE_MAX_LENGTH = 200;
const MAX_SOURCE_SELECTIONS = 10000;

export class CreateCustomGroupDto {
  @ApiProperty({ description: 'A unique collection name within this session', example: 'Marketing groups' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(NAME_MAX_LENGTH)
  name!: string;

  @ApiProperty({ description: 'WhatsApp group IDs to include', type: [String], example: ['120363@g.us'] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_GROUPS)
  @IsString({ each: true })
  groupIds!: string[];

  @ApiPropertyOptional({
    enum: CustomGroupSource,
    default: CustomGroupSource.CUSTOM,
    description: 'The tab/source where this collection was created',
  })
  @IsOptional()
  @IsEnum(CustomGroupSource)
  source?: CustomGroupSource;
}

export class UpdateCustomGroupDto {
  @ApiPropertyOptional({ description: 'Collection name', maxLength: NAME_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(NAME_MAX_LENGTH)
  name?: string;

  @ApiPropertyOptional({ description: 'WhatsApp group IDs to include', type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_GROUPS)
  @IsString({ each: true })
  groupIds?: string[];
}

export class CustomGroupResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() sessionId!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ type: [String] }) groupIds!: string[];
  @ApiProperty({ enum: CustomGroupSource }) source!: CustomGroupSource;
  @ApiProperty() createdAt!: Date;
  @ApiProperty() updatedAt!: Date;
}

export class SupabaseProgramOptionDto {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
}

export class SupabaseCustomGroupSourceQueryDto {
  @ApiPropertyOptional({ type: [String], description: 'Selected Supabase program IDs' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_SOURCE_SELECTIONS)
  @IsString({ each: true })
  programIds?: string[];

  @ApiPropertyOptional({ type: [String], description: 'Selected school.group3 block values' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_SOURCE_SELECTIONS)
  @IsString({ each: true })
  @MaxLength(SOURCE_VALUE_MAX_LENGTH, { each: true })
  groupNames?: string[];
}

export class SupabaseCustomGroupSourceResponseDto {
  @ApiProperty({ description: 'Whether all required Supabase source settings are configured' })
  configured!: boolean;

  @ApiProperty({ type: [SupabaseProgramOptionDto], description: 'Programs loaded from the Supabase program table' })
  programs!: SupabaseProgramOptionDto[];

  @ApiProperty({ type: [String], description: 'Unique school.group3 values for the selected programs' })
  groupNames!: string[];

  @ApiProperty({ type: [String], description: 'WhatsApp group JIDs mapped through matching class rows' })
  mappedGroupIds!: string[];

  @ApiProperty({ description: 'Number of Supabase rows inspected', example: 42 })
  rowsRead!: number;

  @ApiProperty({ description: 'Number of matching school rows inspected', example: 120 })
  schoolRowsRead!: number;

  @ApiProperty({ description: 'Number of matching class rows inspected', example: 80 })
  classRowsRead!: number;

  @ApiProperty({ description: 'Deprecated compatibility field; all matching rows are now paginated' })
  truncated!: boolean;

  @ApiPropertyOptional({ description: 'Configured source table; absent when unconfigured' })
  table?: string;

  @ApiPropertyOptional({ description: 'Configured group-name column; absent when unconfigured' })
  nameColumn?: string;
}
