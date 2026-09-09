import { Repository } from 'typeorm';
import { CustomGroupService } from '../custom-group/custom-group.service';
import { BulkMessageService } from '../message/bulk-message.service';
import { BatchStatus } from '../message/entities/message-batch.entity';
import {
  ScheduledMessage,
  ScheduledMessageScheduleType,
  ScheduledMessageStatus,
} from './entities/scheduled-message.entity';
import { ScheduledMessageService } from './scheduled-message.service';

describe('ScheduledMessageService recurrence', () => {
  const repository = {
    create: jest.fn((value: Partial<ScheduledMessage>) => value as ScheduledMessage),
    save: jest.fn((value: ScheduledMessage) => Promise.resolve(value)),
    update: jest.fn(() => Promise.resolve({ affected: 1 })),
    find: jest.fn(),
  };
  const customGroups = { findOne: jest.fn(() => Promise.resolve({ groupIds: ['group-1@g.us'] })) };
  const bulkMessages = {
    createBatch: jest.fn(),
    getBatchSummary: jest.fn(),
    hasBatchCapacity: jest.fn(() => false),
  };
  let service: ScheduledMessageService;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers().setSystemTime(new Date('2026-09-07T05:00:00.000Z'));
    service = new ScheduledMessageService(
      repository as unknown as Repository<ScheduledMessage>,
      customGroups as unknown as CustomGroupService,
      bulkMessages as unknown as BulkMessageService,
    );
  });

  afterEach(() => jest.useRealTimers());

  it('keeps due schedules pending when all bulk slots are occupied', async () => {
    repository.find.mockResolvedValueOnce([{ id: 'due' }]).mockResolvedValueOnce([]);
    await (service as unknown as { tick(): Promise<void> }).tick();
    expect(repository.update).not.toHaveBeenCalled();
    expect(bulkMessages.createBatch).not.toHaveBeenCalled();
  });

  it('calculates and persists the first selected weekly occurrence', async () => {
    await service.create('session-1', {
      name: 'Parent update',
      customGroupId: 'collection-1',
      messageType: 'text',
      content: { text: 'Hello parents' },
      scheduleType: ScheduledMessageScheduleType.WEEKLY,
      recurrenceDays: [2, 1],
      recurrenceTime: '10:00',
      timezone: 'Asia/Kolkata',
      minDelaySeconds: 2,
      maxDelaySeconds: 10,
    });

    expect(repository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        scheduleType: ScheduledMessageScheduleType.WEEKLY,
        recurrenceDays: [1, 2],
        recurrenceTime: '10:00',
        timezone: 'Asia/Kolkata',
        scheduledAt: new Date('2026-09-08T04:30:00.000Z'),
      }),
    );
  });

  it('returns a completed weekly run to pending with its next occurrence', async () => {
    bulkMessages.getBatchSummary.mockResolvedValue({
      status: BatchStatus.COMPLETED,
      completedAt: new Date('2026-09-08T05:00:00.000Z'),
    });
    const schedule = {
      id: 'schedule-1',
      sessionId: 'session-1',
      batchId: 'scheduled_schedule1_1',
      status: ScheduledMessageStatus.PROCESSING,
      scheduleType: ScheduledMessageScheduleType.WEEKLY,
      recurrenceDays: [1, 2],
      recurrenceTime: '10:00',
      timezone: 'Asia/Kolkata',
      runCount: 0,
    } as ScheduledMessage;

    const reconcile = (service as unknown as { reconcile(value: ScheduledMessage): Promise<void> }).reconcile.bind(
      service,
    );
    await reconcile(schedule);

    expect(repository.update).toHaveBeenCalledWith(
      { id: 'schedule-1', status: ScheduledMessageStatus.PROCESSING },
      expect.objectContaining({
        status: ScheduledMessageStatus.PENDING,
        scheduledAt: new Date('2026-09-14T04:30:00.000Z'),
        batchId: null,
        runCount: 1,
      }),
    );
  });
});
