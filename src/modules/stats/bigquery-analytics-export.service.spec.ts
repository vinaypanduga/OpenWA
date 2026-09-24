import { BigQueryAnalyticsExportService, monthlyAnalyticsWindow } from './bigquery-analytics-export.service';
import { MessageStats, StatsService } from './stats.service';

const analytics: MessageStats = {
  summary: {
    sent: 12,
    received: 7,
    interactions: 4,
    deliveredRecipients: 30,
    readRecipients: 21,
    reactedMessages: 3,
    emojiReactions: 5,
  },
  timeSeries: [{ timestamp: '2026-08-31', sent: 12, received: 7 }],
  byType: { text: 19 },
  byTypeBreakdown: [{ type: 'text', sent: 12, received: 7, total: 19, deliveredRecipients: 30, readRecipients: 21 }],
  bySession: [{ sessionId: 's1', name: 'Primary', sent: 12, received: 7 }],
  topChats: [
    {
      chatId: 'team@g.us',
      chatName: 'Team',
      sent: 12,
      received: 7,
      messageCount: 19,
      deliveredRecipients: 30,
      readRecipients: 21,
      lastActive: '2026-08-31 23:00:00',
    },
  ],
  groupBreakdown: [
    {
      groupId: 'team@g.us',
      groupName: 'Team',
      sent: 12,
      received: 7,
      total: 19,
      deliveredRecipients: 30,
      readRecipients: 21,
    },
  ],
};

describe('monthlyAnalyticsWindow', () => {
  it('ends at the current UTC month boundary and covers exactly the preceding 30 days', () => {
    const window = monthlyAnalyticsWindow(new Date('2026-09-23T18:45:00.000+05:30'));

    expect(window).toEqual({
      exportId: 'openwa-30d-20260901T000000Z',
      start: new Date('2026-08-02T00:00:00.000Z'),
      end: new Date('2026-09-01T00:00:00.000Z'),
    });
    expect(window.end.getTime() - window.start.getTime()).toBe(30 * 24 * 60 * 60 * 1000);
  });

  it('rejects an invalid date', () => {
    expect(() => monthlyAnalyticsWindow(new Date('invalid'))).toThrow(RangeError);
  });
});

describe('BigQueryAnalyticsExportService', () => {
  const enabledConfig = {
    'stats.bigQueryExport.enabled': true,
    'stats.bigQueryExport.projectId': 'example-project',
    'stats.bigQueryExport.datasetId': 'openwa_analytics',
    'stats.bigQueryExport.tableId': 'monthly_message_analytics',
    'stats.bigQueryExport.location': 'australia-southeast1',
  };

  const makeConfig = (values: Record<string, unknown>) => ({
    get: jest.fn((key: string, fallback: unknown) => values[key] ?? fallback),
  });

  const makeBigQuery = (existingRows: unknown[] = [], destinationExists = true) => {
    const table = {
      exists: jest.fn().mockResolvedValue([destinationExists]),
      insert: jest.fn().mockResolvedValue([{}]),
    };
    const dataset = {
      exists: jest.fn().mockResolvedValue([destinationExists]),
      table: jest.fn().mockReturnValue(table),
      createTable: jest.fn().mockResolvedValue([table, {}]),
    };
    const client = {
      dataset: jest.fn().mockReturnValue(dataset),
      createDataset: jest.fn().mockResolvedValue([dataset, {}]),
      query: jest.fn().mockResolvedValue([existingRows]),
    };
    return { client, dataset, table };
  };

  it('creates the destination and exports headline fields plus the complete analytics payload', async () => {
    const stats = { getMessageStatsForRange: jest.fn().mockResolvedValue(analytics) };
    const { client, dataset, table } = makeBigQuery([], false);
    const factory = jest.fn().mockReturnValue(client);
    const service = new BigQueryAnalyticsExportService(
      stats as unknown as StatsService,
      makeConfig(enabledConfig) as never,
      factory,
    );

    await expect(service.exportDueWindow(new Date('2026-09-23T12:00:00.000Z'))).resolves.toBe('exported');

    expect(factory).toHaveBeenCalledWith('example-project');
    expect(client.createDataset).toHaveBeenCalledWith(
      'openwa_analytics',
      expect.objectContaining({ location: 'australia-southeast1' }),
    );
    expect(dataset.createTable).toHaveBeenCalledWith(
      'monthly_message_analytics',
      expect.objectContaining({ timePartitioning: { type: 'DAY', field: 'window_end' } }),
    );
    expect(stats.getMessageStatsForRange).toHaveBeenCalledWith(
      new Date('2026-08-02T00:00:00.000Z'),
      new Date('2026-09-01T00:00:00.000Z'),
    );
    expect(table.insert).toHaveBeenCalledWith(
      {
        insertId: 'openwa-30d-20260901T000000Z',
        json: expect.objectContaining({
          export_id: 'openwa-30d-20260901T000000Z',
          window_days: 30,
          sent: 12,
          received: 7,
          active_groups: 1,
          delivered_recipients: 30,
          read_recipients: 21,
          analytics_json: JSON.stringify(analytics),
        }) as unknown,
      },
      { raw: true },
    );
  });

  it('does not recalculate or insert a snapshot whose export_id is already in BigQuery', async () => {
    const stats = { getMessageStatsForRange: jest.fn() };
    const { client, table } = makeBigQuery([{ export_id: 'openwa-30d-20260901T000000Z' }]);
    const service = new BigQueryAnalyticsExportService(
      stats as unknown as StatsService,
      makeConfig(enabledConfig) as never,
      jest.fn().mockReturnValue(client),
    );

    await expect(service.exportDueWindow(new Date('2026-09-23T12:00:00.000Z'))).resolves.toBe('already-exported');
    expect(stats.getMessageStatsForRange).not.toHaveBeenCalled();
    expect(table.insert).not.toHaveBeenCalled();
  });

  it('does not create a client or query analytics when the exporter is disabled', async () => {
    const stats = { getMessageStatsForRange: jest.fn() };
    const factory = jest.fn();
    const service = new BigQueryAnalyticsExportService(
      stats as unknown as StatsService,
      makeConfig({ 'stats.bigQueryExport.enabled': false }) as never,
      factory,
    );

    await expect(service.exportDueWindow()).resolves.toBe('disabled');
    expect(factory).not.toHaveBeenCalled();
    expect(stats.getMessageStatsForRange).not.toHaveBeenCalled();
  });
});
