import { DataSource } from 'typeorm';
import { Message, MessageDirection, MessageStatus } from '../message/entities/message.entity';
import { MessageBatch, BatchStatus } from '../message/entities/message-batch.entity';
import { ScheduledMessage, ScheduledMessageStatus } from './entities/scheduled-message.entity';
import { HistoryRetentionService } from './history-retention.service';

describe('bounded history retention', () => {
  let data: DataSource;
  beforeEach(async () => {
    data = await new DataSource({
      type: 'better-sqlite3',
      database: ':memory:',
      entities: [Message, MessageBatch, ScheduledMessage],
      synchronize: true,
    }).initialize();
  });
  afterEach(async () => {
    await data.destroy();
  });

  it('removes only expired terminal sends and preserves active work and referenced batches', async () => {
    const messages = data.getRepository(Message);
    for (const [id, direction, status] of [
      ['old-sent', MessageDirection.OUTGOING, MessageStatus.SENT],
      ['pending', MessageDirection.OUTGOING, MessageStatus.PENDING],
      ['incoming', MessageDirection.INCOMING, MessageStatus.SENT],
      ['recent', MessageDirection.OUTGOING, MessageStatus.SENT],
    ]) {
      await messages.save(
        messages.create({
          id,
          sessionId: 's',
          chatId: 'c',
          from: 'a',
          to: 'b',
          direction: direction as MessageDirection,
          status: status as MessageStatus,
        }),
      );
    }
    await data.query(`UPDATE messages SET "createdAt" = '2020-01-01 00:00:00' WHERE id <> 'recent'`);
    const batches = data.getRepository(MessageBatch);
    for (const [id, status] of [
      ['finished', BatchStatus.COMPLETED],
      ['referenced', BatchStatus.COMPLETED],
      ['running', BatchStatus.PROCESSING],
    ]) {
      await batches.save(
        batches.create({ id, batchId: id, sessionId: 's', messages: [], status: status as BatchStatus }),
      );
    }
    await data.query(`UPDATE message_batches SET updated_at = '2020-01-01 00:00:00'`);
    const schedules = data.getRepository(ScheduledMessage);
    for (const [id, status] of [
      ['done', ScheduledMessageStatus.COMPLETED],
      ['active', ScheduledMessageStatus.PROCESSING],
      ['weekly', ScheduledMessageStatus.PENDING],
    ]) {
      await schedules.save(
        schedules.create({
          id,
          sessionId: 's',
          customGroupId: 'g',
          name: id,
          messageType: 'text',
          content: { text: 'hello' },
          scheduledAt: new Date(),
          status: status as ScheduledMessageStatus,
          batchId: id === 'active' ? 'referenced' : null,
        }),
      );
    }
    await data.query(`UPDATE scheduled_messages SET "updatedAt" = '2020-01-01 00:00:00'`);
    expect(await new HistoryRetentionService(data).sweep(3)).toBe(3);
    expect((await messages.find()).map(row => row.id).sort()).toEqual(['incoming', 'pending', 'recent']);
    expect((await batches.find()).map(row => row.id).sort()).toEqual(['referenced', 'running']);
    expect((await schedules.find()).map(row => row.id).sort()).toEqual(['active', 'weekly']);
  });

  it('limits each table to 100 deletions per sweep and supports disabling retention', async () => {
    const repository = data.getRepository(MessageBatch);
    await repository.insert(
      Array.from({ length: 105 }, (_, index) => ({
        sessionId: 's',
        batchId: String(index),
        status: BatchStatus.COMPLETED,
        messages: [],
      })),
    );
    await data.query(`UPDATE message_batches SET updated_at = '2020-01-01 00:00:00'`);
    const service = new HistoryRetentionService(data);
    expect(await service.sweep(0)).toBe(0);
    expect(await service.sweep(3)).toBe(100);
    expect(await repository.count()).toBe(5);
  });
});
