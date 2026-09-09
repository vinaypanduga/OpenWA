import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayNotEmpty,
  ArrayUnique,
  IsArray,
  IsDateString,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Matches,
  Min,
  ValidateIf,
} from 'class-validator';
import { ScheduledMessageScheduleType, ScheduledMessageStatus } from '../entities/scheduled-message.entity';

const MAX_DELAY_SECONDS = 3600;

class ScheduledMediaDto {
  @ApiPropertyOptional({ description: 'Media URL (http/https)' })
  @IsOptional()
  @IsString()
  url?: string;

  @ApiPropertyOptional({ description: 'Base64 encoded media data' })
  @IsOptional()
  @IsString()
  base64?: string;

  @ApiPropertyOptional({ description: 'Media MIME type when using base64' })
  @IsOptional()
  @IsString()
  mimetype?: string;

  @ApiPropertyOptional({ description: 'Filename for document messages' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  filename?: string;

  @ApiPropertyOptional({ description: 'Audio only: send as a voice note' })
  @IsOptional()
  ptt?: boolean;
}

export class ScheduledMessageContentDto {
  @ApiPropertyOptional({ description: 'Text content' })
  @IsOptional()
  @IsString()
  @MaxLength(4096)
  text?: string;

  @ApiPropertyOptional({ type: ScheduledMediaDto })
  @IsOptional()
  @IsObject()
  image?: ScheduledMediaDto;

  @ApiPropertyOptional({ type: ScheduledMediaDto })
  @IsOptional()
  @IsObject()
  video?: ScheduledMediaDto;

  @ApiPropertyOptional({ type: ScheduledMediaDto })
  @IsOptional()
  @IsObject()
  audio?: ScheduledMediaDto;

  @ApiPropertyOptional({ type: ScheduledMediaDto })
  @IsOptional()
  @IsObject()
  document?: ScheduledMediaDto;

  @ApiPropertyOptional({ description: 'Caption for media messages', maxLength: 1024 })
  @IsOptional()
  @IsString()
  @MaxLength(1024)
  caption?: string;
}

export class CreateScheduledMessageDto {
  @ApiProperty({ description: 'Name shown in the scheduled-message list', example: 'Weekly parent update' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name!: string;

  @ApiProperty({ description: 'Saved custom group collection ID' })
  @IsString()
  @IsNotEmpty()
  customGroupId!: string;

  @ApiProperty({ enum: ['text', 'image', 'video', 'audio', 'document'], example: 'video' })
  @IsIn(['text', 'image', 'video', 'audio', 'document'])
  messageType!: 'text' | 'image' | 'video' | 'audio' | 'document';

  @ApiProperty({ type: ScheduledMessageContentDto })
  @IsObject()
  content!: ScheduledMessageContentDto;

  @ApiPropertyOptional({
    description: 'One-time send date (ISO-8601). Required unless scheduleType is weekly.',
    example: '2026-09-08T14:30:00.000Z',
  })
  @ValidateIf((value: CreateScheduledMessageDto) => value.scheduleType !== ScheduledMessageScheduleType.WEEKLY)
  @IsDateString()
  scheduledAt?: string;

  @ApiPropertyOptional({ enum: ScheduledMessageScheduleType, default: ScheduledMessageScheduleType.ONCE })
  @IsOptional()
  @IsIn(Object.values(ScheduledMessageScheduleType))
  scheduleType?: ScheduledMessageScheduleType;

  @ApiPropertyOptional({
    description: 'Weekly recurrence weekdays, where 0 is Sunday and 6 is Saturday',
    example: [1, 2],
  })
  @ValidateIf((value: CreateScheduledMessageDto) => value.scheduleType === ScheduledMessageScheduleType.WEEKLY)
  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique()
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(6, { each: true })
  recurrenceDays?: number[];

  @ApiPropertyOptional({ description: 'Weekly send time in 24-hour HH:mm format', example: '10:00' })
  @ValidateIf((value: CreateScheduledMessageDto) => value.scheduleType === ScheduledMessageScheduleType.WEEKLY)
  @IsString()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/)
  recurrenceTime?: string;

  @ApiPropertyOptional({ description: 'IANA timezone for the weekly wall-clock time', example: 'Asia/Kolkata' })
  @ValidateIf((value: CreateScheduledMessageDto) => value.scheduleType === ScheduledMessageScheduleType.WEEKLY)
  @IsString()
  @MaxLength(100)
  timezone?: string;

  @ApiPropertyOptional({
    description: 'Minimum random delay between groups in seconds',
    default: 2,
    minimum: 0,
    maximum: MAX_DELAY_SECONDS,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(MAX_DELAY_SECONDS)
  minDelaySeconds?: number;

  @ApiPropertyOptional({
    description: 'Maximum random delay between groups in seconds',
    default: 10,
    minimum: 0,
    maximum: MAX_DELAY_SECONDS,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(MAX_DELAY_SECONDS)
  maxDelaySeconds?: number;
}

export class ScheduledMessageResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() sessionId!: string;
  @ApiProperty() customGroupId!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ enum: ['text', 'image', 'video', 'audio', 'document'] }) messageType!: string;
  @ApiProperty() content!: Record<string, unknown>;
  @ApiProperty({ type: String, format: 'date-time' }) scheduledAt!: Date;
  @ApiProperty({ enum: ScheduledMessageScheduleType }) scheduleType!: ScheduledMessageScheduleType;
  @ApiPropertyOptional({ type: [Number], nullable: true }) recurrenceDays!: number[] | null;
  @ApiPropertyOptional({ nullable: true }) recurrenceTime!: string | null;
  @ApiPropertyOptional({ nullable: true }) timezone!: string | null;
  @ApiProperty() runCount!: number;
  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true }) lastRunAt!: Date | null;
  @ApiProperty() minDelaySeconds!: number;
  @ApiProperty() maxDelaySeconds!: number;
  @ApiProperty({ enum: ScheduledMessageStatus }) status!: ScheduledMessageStatus;
  @ApiPropertyOptional({ nullable: true }) batchId!: string | null;
  @ApiPropertyOptional({ nullable: true }) error!: string | null;
  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true }) startedAt!: Date | null;
  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true }) completedAt!: Date | null;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt!: Date;
  @ApiProperty({ type: String, format: 'date-time' }) updatedAt!: Date;
}
