import { BigQueryAnalyticsExportService, sevenDayAnalyticsWindow } from './bigquery-analytics-export.service';
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

describe('sevenDayAnalyticsWindow', () => {
  it('ends at the latest completed UTC midnight and covers exactly the preceding 7 days', () => {
    const window = sevenDayAnalyticsWindow(new Date('2026-09-23T18:45:00.000+05:30'));

    expect(window).toEqual({
      exportId: 'openwa-7d-20260923T000000Z',
      start: new Date('2026-09-16T00:00:00.000Z'),
      end: new Date('2026-09-23T00:00:00.000Z'),
    });
    expect(window.end.getTime() - window.start.getTime()).toBe(7 * 24 * 60 * 60 * 1000);
  });

  it('rejects an invalid date', () => {
    expect(() => sevenDayAnalyticsWindow(new Date('invalid'))).toThrow(RangeError);
  });
});

describe('BigQueryAnalyticsExportService', () => {
  const enabledConfig = {
    'stats.bigQueryExport.enabled': true,
    'stats.bigQueryExport.projectId': 'example-project',
    'stats.bigQueryExport.datasetId': 'openwa_analytics',
    'stats.bigQueryExport.tableId': 'message_analytics_7d',
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
    const createTable = jest
      .fn<
        Promise<unknown[]>,
        [string, { schema: Array<{ name: string }>; timePartitioning: { type: string; field: string } }]
      >()
      .mockResolvedValue([table, {}]);
    const dataset = {
      exists: jest.fn().mockResolvedValue([destinationExists]),
      table: jest.fn().mockReturnValue(table),
      createTable,
    };
    const client = {
      dataset: jest.fn().mockReturnValue(dataset),
      createDataset: jest.fn().mockResolvedValue([dataset, {}]),
      query: jest.fn().mockResolvedValue([existingRows]),
    };
    return { client, dataset, table };
  };

  it('creates the destination and exports only aggregate analytics fields', async () => {
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
      'message_analytics_7d',
      expect.objectContaining({ timePartitioning: { type: 'DAY', field: 'window_end' } }),
    );
    const createOptions = dataset.createTable.mock.calls[0][1];
    expect(createOptions.schema.map(field => field.name)).not.toContain('analytics_json');
    expect(stats.getMessageStatsForRange).toHaveBeenCalledWith(
      new Date('2026-09-16T00:00:00.000Z'),
      new Date('2026-09-23T00:00:00.000Z'),
    );
    expect(table.insert).toHaveBeenCalledWith(
      {
        insertId: 'openwa-7d-20260923T000000Z',
        json: expect.objectContaining({
          export_id: 'openwa-7d-20260923T000000Z',
          window_days: 7,
          sent: 12,
          received: 7,
          active_groups: 1,
          delivered_recipients: 30,
          read_recipients: 21,
        }) as unknown,
      },
      { raw: true },
    );
  });

  it('does not export until 7 days after the latest BigQuery window', async () => {
    const stats = { getMessageStatsForRange: jest.fn() };
    const { client, table } = makeBigQuery([
      { export_id: 'openwa-15d-20260923T000000Z', window_end: { value: '2026-09-23T00:00:00.000Z' } },
    ]);
    const service = new BigQueryAnalyticsExportService(
      stats as unknown as StatsService,
      makeConfig(enabledConfig) as never,
      jest.fn().mockReturnValue(client),
    );

    await expect(service.exportDueWindow(new Date('2026-09-23T12:00:00.000Z'))).resolves.toBe('already-exported');
    expect(stats.getMessageStatsForRange).not.toHaveBeenCalled();
    expect(table.insert).not.toHaveBeenCalled();
  });

  it('continues with the next consecutive 7-day window when it is due, including after a legacy 15-day row', async () => {
    const stats = { getMessageStatsForRange: jest.fn().mockResolvedValue(analytics) };
    const { client, table } = makeBigQuery([
      { export_id: 'openwa-15d-20260923T000000Z', window_end: '2026-09-23T00:00:00.000Z' },
    ]);
    const service = new BigQueryAnalyticsExportService(
      stats as unknown as StatsService,
      makeConfig(enabledConfig) as never,
      jest.fn().mockReturnValue(client),
    );

    await expect(service.exportDueWindow(new Date('2026-09-30T12:00:00.000Z'))).resolves.toBe('exported');
    expect(stats.getMessageStatsForRange).toHaveBeenCalledWith(
      new Date('2026-09-23T00:00:00.000Z'),
      new Date('2026-09-30T00:00:00.000Z'),
    );
    expect(table.insert).toHaveBeenCalledWith(expect.objectContaining({ insertId: 'openwa-7d-20260930T000000Z' }), {
      raw: true,
    });
  });

  it('publishes an in-progress first window immediately from the explicit start boundary', async () => {
    const stats = { getMessageStatsForRange: jest.fn().mockResolvedValue(analytics) };
    const { client, table } = makeBigQuery([]);
    const service = new BigQueryAnalyticsExportService(
      stats as unknown as StatsService,
      makeConfig({
        ...enabledConfig,
        'stats.bigQueryExport.startAt': '2026-09-28T00:00:00.000Z',
      }) as never,
      jest.fn().mockReturnValue(client),
    );

    await expect(service.exportDueWindow(new Date('2026-10-01T00:00:00.000Z'))).resolves.toBe('exported');
    expect(stats.getMessageStatsForRange).toHaveBeenCalledWith(
      new Date('2026-09-28T00:00:00.000Z'),
      new Date('2026-10-01T00:00:00.000Z'),
    );
    expect(client.query).toHaveBeenCalledTimes(2);
    expect(table.insert).not.toHaveBeenCalled();
  });

  it('exports the first complete window from the explicit start boundary when due', async () => {
    const stats = { getMessageStatsForRange: jest.fn().mockResolvedValue(analytics) };
    const { client, table } = makeBigQuery([]);
    const service = new BigQueryAnalyticsExportService(
      stats as unknown as StatsService,
      makeConfig({
        ...enabledConfig,
        'stats.bigQueryExport.startAt': '2026-09-28T00:00:00.000Z',
      }) as never,
      jest.fn().mockReturnValue(client),
    );

    await expect(service.exportDueWindow(new Date('2026-10-05T00:00:00.000Z'))).resolves.toBe('exported');
    expect(stats.getMessageStatsForRange).toHaveBeenCalledWith(
      new Date('2026-09-28T00:00:00.000Z'),
      new Date('2026-10-05T00:00:00.000Z'),
    );
    expect(client.query).toHaveBeenCalledTimes(2);
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
