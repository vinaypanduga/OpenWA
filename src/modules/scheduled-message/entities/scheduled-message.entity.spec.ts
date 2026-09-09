import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { AddScheduledMessages1786500000000 } from '../../../database/migrations/1786500000000-AddScheduledMessages';
import { AddScheduledMessageRecurrence1786600000000 } from '../../../database/migrations/1786600000000-AddScheduledMessageRecurrence';
import { ScheduledMessage, ScheduledMessageScheduleType, ScheduledMessageStatus } from './scheduled-message.entity';

describe('ScheduledMessage timestamps', () => {
  let dataSource: DataSource;

  beforeEach(async () => {
    dataSource = new DataSource({
      type: 'better-sqlite3',
      database: ':memory:',
      entities: [ScheduledMessage],
      synchronize: false,
    });
    await dataSource.initialize();
    await dataSource.query('CREATE TABLE "sessions" ("id" varchar PRIMARY KEY NOT NULL)');
    await dataSource.query('CREATE TABLE "custom_groups" ("id" varchar PRIMARY KEY NOT NULL)');
    await dataSource.query('INSERT INTO "sessions" ("id") VALUES (?)', ['session-1']);
    await dataSource.query('INSERT INTO "custom_groups" ("id") VALUES (?)', ['collection-1']);
    const queryRunner = dataSource.createQueryRunner();
    try {
      await new AddScheduledMessages1786500000000().up(queryRunner);
      await new AddScheduledMessageRecurrence1786600000000().up(queryRunner);
    } finally {
      await queryRunner.release();
    }
  });

  afterEach(async () => {
    await dataSource.destroy();
  });

  it('populates generated timestamps when inserting into the migration-managed SQLite schema', async () => {
    const repository = dataSource.getRepository(ScheduledMessage);
    const saved = await repository.save(
      repository.create({
        sessionId: 'session-1',
        customGroupId: 'collection-1',
        name: 'Parent update',
        messageType: 'text',
        content: { text: 'Hello parents' },
        scheduledAt: new Date(Date.now() + 60_000),
        minDelaySeconds: 2,
        maxDelaySeconds: 10,
        status: ScheduledMessageStatus.PENDING,
        batchId: null,
        error: null,
        startedAt: null,
        completedAt: null,
      }),
    );

    expect(saved.createdAt).toBeInstanceOf(Date);
    expect(saved.updatedAt).toBeInstanceOf(Date);
    expect(saved.scheduleType).toBe(ScheduledMessageScheduleType.ONCE);
    expect(saved.runCount).toBe(0);
  });
});
