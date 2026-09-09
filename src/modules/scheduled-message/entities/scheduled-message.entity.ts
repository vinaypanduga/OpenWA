import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { dateColumnType, jsonColumnType } from '../../../common/utils/column-types';
import { DateTransformer } from '../../../common/transformers/date.transformer';

export enum ScheduledMessageStatus {
  PENDING = 'pending',
  PROCESSING = 'processing',
  COMPLETED = 'completed',
  FAILED = 'failed',
  CANCELLED = 'cancelled',
}

export enum ScheduledMessageScheduleType {
  ONCE = 'once',
  WEEKLY = 'weekly',
}

export type ScheduledMessageType = 'text' | 'image' | 'video' | 'audio' | 'document';

@Entity('scheduled_messages')
@Index('IDX_schedules_retention', ['status', 'updatedAt'])
@Index('IDX_schedules_batch', ['sessionId', 'batchId', 'status'])
@Index('IDX_scheduled_messages_due', ['status', 'scheduledAt'])
@Index('IDX_scheduled_messages_session', ['sessionId', 'createdAt'])
export class ScheduledMessage {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar' })
  sessionId!: string;

  @Column({ type: 'varchar' })
  customGroupId!: string;

  @Column({ type: 'varchar', length: 100 })
  name!: string;

  @Column({ type: 'varchar', length: 20 })
  messageType!: ScheduledMessageType;

  @Column({ type: jsonColumnType() })
  content!: Record<string, unknown>;

  @Column({ type: dateColumnType(), transformer: DateTransformer })
  scheduledAt!: Date;

  @Column({ type: 'varchar', length: 20, default: ScheduledMessageScheduleType.ONCE })
  scheduleType!: ScheduledMessageScheduleType;

  @Column({ type: jsonColumnType(), nullable: true })
  recurrenceDays!: number[] | null;

  @Column({ type: 'varchar', length: 5, nullable: true })
  recurrenceTime!: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  timezone!: string | null;

  @Column({ type: 'integer', default: 0 })
  runCount!: number;

  @Column({ type: dateColumnType(), nullable: true, transformer: DateTransformer })
  lastRunAt!: Date | null;

  @Column({ type: 'integer', default: 2 })
  minDelaySeconds!: number;

  @Column({ type: 'integer', default: 10 })
  maxDelaySeconds!: number;

  @Column({ type: 'varchar', default: ScheduledMessageStatus.PENDING })
  status!: ScheduledMessageStatus;

  @Column({ type: 'varchar', nullable: true })
  batchId!: string | null;

  @Column({ type: 'text', nullable: true })
  error!: string | null;

  @Column({ type: dateColumnType(), nullable: true, transformer: DateTransformer })
  startedAt!: Date | null;

  @Column({ type: dateColumnType(), nullable: true, transformer: DateTransformer })
  completedAt!: Date | null;

  // Let TypeORM choose the driver-native generated-date type. Applying DateTransformer to a
  // CreateDateColumn makes TypeORM bind NULL explicitly on SQLite instead of using CURRENT_TIMESTAMP.
  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
