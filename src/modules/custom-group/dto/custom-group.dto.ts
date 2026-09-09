import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

const NAME_MAX_LENGTH = 100;
const MAX_GROUPS = 1000;

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
  @ApiProperty() createdAt!: Date;
  @ApiProperty() updatedAt!: Date;
}
