import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, In, LessThan, Not } from 'typeorm';
import { Message, MessageDirection, MessageStatus } from '../message/entities/message.entity';
import { MessageBatch, BatchStatus } from '../message/entities/message-batch.entity';
import { ScheduledMessage, ScheduledMessageStatus } from './entities/scheduled-message.entity';

const TERMINAL_SCHEDULES = [
  ScheduledMessageStatus.COMPLETED,
  ScheduledMessageStatus.FAILED,
  ScheduledMessageStatus.CANCELLED,
];
const TERMINAL_BATCHES = [BatchStatus.COMPLETED, BatchStatus.FAILED, BatchStatus.CANCELLED];

/** Opt-in, bounded retention: never load message bodies/media or vacuum the live SQLite database. */
@Injectable()
export class HistoryRetentionService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(HistoryRetentionService.name);
  private timer?: NodeJS.Timeout;
  private sweeping = false;

  constructor(@InjectDataSource('data') private readonly data: DataSource) {}

  onModuleInit(): void {
    const days = Number(process.env.MESSAGE_HISTORY_RETENTION_DAYS ?? 0);
    if (!Number.isInteger(days) || days <= 0) return;
    // Delay the first sweep to avoid competing with session reconnection at boot. At most 100
    // rows/table/minute, with an overlap guard, keeps catch-up work bounded even on a large DB.
    this.timer = setInterval(() => {
      void this.sweep(days).catch(error => this.logger.error('History retention failed', error));
    }, 60_000);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async sweep(days: number, now = new Date()): Promise<number> {
    if (this.sweeping || !Number.isInteger(days) || days <= 0) return 0;
    this.sweeping = true;
    let deleted = 0;
    try {
      const cutoff = new Date(now.getTime() - days * 86_400_000);
      const messages = this.data.getRepository(Message);
      const eligibleMessage = {
        direction: MessageDirection.OUTGOING,
        status: Not(MessageStatus.PENDING),
        createdAt: LessThan(cutoff),
      };
      const oldMessages = await messages.find({
        select: { id: true },
        where: eligibleMessage,
        order: { createdAt: 'ASC' },
        take: 100,
      });
      if (oldMessages.length) {
        deleted +=
          (await messages.delete({ ...eligibleMessage, id: In(oldMessages.map(row => row.id)) })).affected ?? 0;
      }

      const schedules = this.data.getRepository(ScheduledMessage);
      const eligibleSchedule = { status: In(TERMINAL_SCHEDULES), updatedAt: LessThan(cutoff) };
      const oldSchedules = await schedules.find({
        select: { id: true },
        where: eligibleSchedule,
        order: { updatedAt: 'ASC' },
        take: 100,
      });
      if (oldSchedules.length) {
        deleted +=
          (await schedules.delete({ ...eligibleSchedule, id: In(oldSchedules.map(row => row.id)) })).affected ?? 0;
      }

      const batches = this.data.getRepository(MessageBatch);
      // A processing schedule still needs its terminal batch for reconciliation after a restart.
      const activeReference = `NOT EXISTS (SELECT 1 FROM scheduled_messages s WHERE s."sessionId" = b."session_id" AND s."batchId" = b."batch_id" AND s.status IN (:...active))`;
      const parameters = { terminal: TERMINAL_BATCHES, active: ['pending', 'processing'], cutoff };
      const oldBatches = await batches
        .createQueryBuilder('b')
        .select('b.id')
        .where('b.status IN (:...terminal)', parameters)
        .andWhere('b.updatedAt < :cutoff')
        .andWhere(activeReference)
        .orderBy('b.updatedAt', 'ASC')
        .take(100)
        .getMany();
      // Recheck status/reference at deletion so cleanup cannot race reconciliation or cancellation.
      if (oldBatches.length) {
        const ids = oldBatches.map(row => row.id);
        deleted +=
          (
            await batches
              .createQueryBuilder()
              .delete()
              .whereInIds(ids)
              .andWhere('status IN (:...terminal)', parameters)
              .andWhere(
                `NOT EXISTS (SELECT 1 FROM scheduled_messages s WHERE s."sessionId" = message_batches."session_id" AND s."batchId" = message_batches."batch_id" AND s.status IN (:...active))`,
                parameters,
              )
              .execute()
          ).affected ?? 0;
      }
      if (deleted) this.logger.log(`Removed ${deleted} expired history rows (retention ${days} days)`);
      return deleted;
    } finally {
      this.sweeping = false;
    }
  }
}
