import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThanOrEqual, Repository } from 'typeorm';
import { BulkMessageService } from '../message/bulk-message.service';
import { BatchStatus } from '../message/entities/message-batch.entity';
import { CustomGroupService } from '../custom-group/custom-group.service';
import { CreateScheduledMessageDto } from './dto';
import {
  ScheduledMessage,
  ScheduledMessageScheduleType,
  ScheduledMessageStatus,
} from './entities/scheduled-message.entity';
import { isValidTimeZone, nextWeeklyOccurrence } from './weekly-recurrence';

const POLL_INTERVAL_MS = 5000;

@Injectable()
export class ScheduledMessageService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(ScheduledMessageService.name);
  private timer?: NodeJS.Timeout;
  private ticking = false;

  constructor(
    @InjectRepository(ScheduledMessage, 'data') private readonly repository: Repository<ScheduledMessage>,
    private readonly customGroups: CustomGroupService,
    private readonly bulkMessages: BulkMessageService,
  ) {}

  onApplicationBootstrap(): void {
    this.timer = setInterval(() => void this.tick(), POLL_INTERVAL_MS);
    void this.tick();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async create(sessionId: string, dto: CreateScheduledMessageDto): Promise<ScheduledMessage> {
    const scheduleType = dto.scheduleType ?? ScheduledMessageScheduleType.ONCE;
    let scheduledAt: Date;
    let recurrenceDays: number[] | null = null;
    let recurrenceTime: string | null = null;
    let timezone: string | null = null;
    if (scheduleType === ScheduledMessageScheduleType.WEEKLY) {
      recurrenceDays = [...new Set(dto.recurrenceDays ?? [])].sort((left, right) => left - right);
      recurrenceTime = dto.recurrenceTime ?? '';
      timezone = dto.timezone ?? '';
      if (!recurrenceDays.length) throw new BadRequestException('Select at least one weekday');
      if (recurrenceDays.some(day => !Number.isInteger(day) || day < 0 || day > 6)) {
        throw new BadRequestException('recurrenceDays must contain weekdays from 0 to 6');
      }
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(recurrenceTime)) {
        throw new BadRequestException('recurrenceTime must use 24-hour HH:mm format');
      }
      if (!timezone || !isValidTimeZone(timezone)) {
        throw new BadRequestException('timezone must be a valid IANA timezone');
      }
      scheduledAt = nextWeeklyOccurrence(recurrenceDays, recurrenceTime, timezone, new Date());
    } else {
      scheduledAt = new Date(dto.scheduledAt ?? '');
      if (Number.isNaN(scheduledAt.getTime()) || scheduledAt.getTime() <= Date.now()) {
        throw new BadRequestException('scheduledAt must be a future date and time');
      }
    }
    const minDelaySeconds = dto.minDelaySeconds ?? 2;
    const maxDelaySeconds = dto.maxDelaySeconds ?? 10;
    if (maxDelaySeconds < minDelaySeconds) {
      throw new BadRequestException('maxDelaySeconds must be greater than or equal to minDelaySeconds');
    }
    this.validateContent(dto.messageType, dto.content);
    await this.customGroups.findOne(sessionId, dto.customGroupId);
    const entity = this.repository.create({
      sessionId,
      customGroupId: dto.customGroupId,
      name: dto.name.trim(),
      messageType: dto.messageType,
      content: dto.content as Record<string, unknown>,
      scheduledAt,
      scheduleType,
      recurrenceDays,
      recurrenceTime,
      timezone,
      runCount: 0,
      lastRunAt: null,
      minDelaySeconds,
      maxDelaySeconds,
      status: ScheduledMessageStatus.PENDING,
      batchId: null,
      error: null,
      startedAt: null,
      completedAt: null,
    });
    return this.repository.save(entity);
  }

  findBySession(sessionId: string): Promise<ScheduledMessage[]> {
    return this.repository.find({ where: { sessionId }, order: { scheduledAt: 'ASC' } });
  }

  async findOne(sessionId: string, id: string): Promise<ScheduledMessage> {
    const schedule = await this.repository.findOne({ where: { id, sessionId } });
    if (!schedule) throw new NotFoundException(`Scheduled message with id '${id}' not found`);
    return schedule;
  }

  async cancel(sessionId: string, id: string): Promise<ScheduledMessage> {
    const schedule = await this.findOne(sessionId, id);
    if (![ScheduledMessageStatus.PENDING, ScheduledMessageStatus.PROCESSING].includes(schedule.status)) {
      throw new BadRequestException(`Scheduled message is already ${schedule.status}`);
    }
    schedule.status = ScheduledMessageStatus.CANCELLED;
    schedule.completedAt = new Date();
    return this.repository.save(schedule);
  }

  private validateContent(
    type: CreateScheduledMessageDto['messageType'],
    content: CreateScheduledMessageDto['content'],
  ): void {
    const media = type === 'text' ? undefined : content[type];
    if (type === 'text' && !content.text?.trim()) throw new BadRequestException('Text message content is required');
    if (type !== 'text' && (!media || typeof media !== 'object' || !(media.url || media.base64))) {
      throw new BadRequestException(`${type} media must include a URL or base64 data`);
    }
  }

  private async tick(): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      const due = await this.repository.find({
        where: { status: ScheduledMessageStatus.PENDING, scheduledAt: LessThanOrEqual(new Date()) },
        order: { scheduledAt: 'ASC' },
        take: 20,
      });
      for (const schedule of due) {
        // Leave due schedules queued when send capacity is full, rather than fail the campaign.
        if (!this.bulkMessages.hasBatchCapacity()) break;
        await this.start(schedule);
      }
      const active = await this.repository.find({
        select: {
          id: true,
          sessionId: true,
          batchId: true,
          scheduleType: true,
          recurrenceDays: true,
          recurrenceTime: true,
          timezone: true,
          runCount: true,
        },
        where: { status: ScheduledMessageStatus.PROCESSING },
      });
      for (const schedule of active) await this.reconcile(schedule);
    } catch (error) {
      this.logger.error(
        `Scheduled-message worker tick failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      this.ticking = false;
    }
  }

  private async start(schedule: ScheduledMessage): Promise<void> {
    const batchId = `scheduled_${schedule.id.replace(/-/g, '').slice(0, 20)}_${schedule.runCount + 1}`;
    const claimed = await this.repository.update(
      { id: schedule.id, status: ScheduledMessageStatus.PENDING },
      { status: ScheduledMessageStatus.PROCESSING, startedAt: new Date(), batchId, error: null },
    );
    if (!claimed.affected) return;
    try {
      const collection = await this.customGroups.findOne(schedule.sessionId, schedule.customGroupId);
      if (!collection.groupIds.length) throw new BadRequestException('The custom group has no selected groups');
      await this.bulkMessages.createBatch(schedule.sessionId, {
        batchId,
        messages: collection.groupIds.map(chatId => ({
          chatId,
          type: schedule.messageType,
          content: schedule.content,
        })),
        options: {
          delayBetweenMessages: schedule.minDelaySeconds * 1000,
          minDelayBetweenMessages: schedule.minDelaySeconds * 1000,
          maxDelayBetweenMessages: schedule.maxDelaySeconds * 1000,
          randomizeDelay: true,
          stopOnError: false,
        },
      });
    } catch (error) {
      const completedAt = new Date();
      const message = error instanceof Error ? error.message : String(error);
      if (schedule.scheduleType === ScheduledMessageScheduleType.WEEKLY) {
        await this.rescheduleWeekly(schedule, completedAt, message);
      } else {
        await this.repository.update(
          { id: schedule.id, status: ScheduledMessageStatus.PROCESSING },
          {
            status: ScheduledMessageStatus.FAILED,
            completedAt,
            lastRunAt: completedAt,
            runCount: schedule.runCount + 1,
            error: message,
          },
        );
      }
      this.logger.error(`Scheduled message ${schedule.id} failed to start: ${message}`);
    }
  }

  private async reconcile(schedule: ScheduledMessage): Promise<void> {
    if (!schedule.batchId) return;
    try {
      const batch = await this.bulkMessages.getBatchSummary(schedule.sessionId, schedule.batchId);
      const terminalStatus =
        batch.status === BatchStatus.COMPLETED
          ? ScheduledMessageStatus.COMPLETED
          : batch.status === BatchStatus.FAILED
            ? ScheduledMessageStatus.FAILED
            : batch.status === BatchStatus.CANCELLED
              ? ScheduledMessageStatus.CANCELLED
              : undefined;
      if (terminalStatus) {
        const completedAt = batch.completedAt ?? new Date();
        const error = terminalStatus === ScheduledMessageStatus.FAILED ? 'One or more scheduled messages failed' : null;
        if (
          schedule.scheduleType === ScheduledMessageScheduleType.WEEKLY &&
          terminalStatus !== ScheduledMessageStatus.CANCELLED
        ) {
          await this.rescheduleWeekly(schedule, completedAt, error);
        } else {
          await this.repository.update(
            { id: schedule.id, status: ScheduledMessageStatus.PROCESSING },
            {
              status: terminalStatus,
              completedAt,
              lastRunAt: completedAt,
              runCount: schedule.runCount + 1,
              error,
            },
          );
        }
      }
    } catch (error) {
      // A newly-created batch may not be visible in the same database read yet; leave it processing
      // and retry on the next worker tick rather than sending a duplicate batch.
      this.logger.warn(
        `Could not reconcile scheduled message ${schedule.id}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private async rescheduleWeekly(schedule: ScheduledMessage, completedAt: Date, error: string | null): Promise<void> {
    if (!schedule.recurrenceDays?.length || !schedule.recurrenceTime || !schedule.timezone) {
      throw new Error(`Weekly scheduled message ${schedule.id} is missing recurrence settings`);
    }
    await this.repository.update(
      { id: schedule.id, status: ScheduledMessageStatus.PROCESSING },
      {
        status: ScheduledMessageStatus.PENDING,
        scheduledAt: nextWeeklyOccurrence(
          schedule.recurrenceDays,
          schedule.recurrenceTime,
          schedule.timezone,
          completedAt,
        ),
        batchId: null,
        startedAt: null,
        completedAt,
        lastRunAt: completedAt,
        runCount: schedule.runCount + 1,
        error,
      },
    );
  }
}
