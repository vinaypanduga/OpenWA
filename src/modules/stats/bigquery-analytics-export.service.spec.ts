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
      reactedMessages: 3,
      emojiReactions: 5,
    },
  ],
};

const apiAnalytics: MessageStats = {
  ...analytics,
  summary: {
    sent: 5,
    received: 2,
    interactions: 2,
    deliveredRecipients: 14,
    readRecipients: 9,
    reactedMessages: 1,
    emojiReactions: 2,
  },
  bySession: [{ sessionId: 'api-1', name: 'API', sent: 5, received: 2 }],
  groupBreakdown: [
    {
      groupId: 'api-team@g.us',
      groupName: 'API Team',
      sent: 5,
      received: 2,
      total: 7,
      deliveredRecipients: 14,
      readRecipients: 9,
      reactedMessages: 1,
      emojiReactions: 2,
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
  interface QueryRequest {
    query: string;
    params?: { rows?: Array<Record<string, unknown>>; [key: string]: unknown };
    location?: string;
  }

  const targetAudienceStats = {
    sent: 8,
    received: 3,
    interactions: 2,
    activeGroups: 2,
    deliveredRecipients: 18,
    readRecipients: 11,
    reactedMessages: 2,
    emojiReactions: 4,
  };
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
      getMetadata: jest.fn().mockResolvedValue([{ schema: { fields: [{ name: 'target_audience', type: 'STRING' }] } }]),
      setMetadata: jest.fn().mockResolvedValue([{}]),
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
    const query = jest.fn<Promise<[unknown[]]>, [QueryRequest]>().mockResolvedValue([existingRows]);
    const client = {
      dataset: jest.fn().mockReturnValue(dataset),
      createDataset: jest.fn().mockResolvedValue([dataset, {}]),
      query,
    };
    return { client, dataset, table };
  };

  const makeCustomGroupRepository = () => ({
    find: jest
      .fn()
      .mockResolvedValue([{ name: 'Teachers', sessionId: 'normal-1', groupIds: ['team@g.us', 'staff@g.us'] }]),
  });

  it('creates the destination and exports only aggregate analytics fields', async () => {
    const stats = {
      getMessageStatsForRange: jest.fn().mockResolvedValue(analytics),
      getTargetAudienceStatsForRange: jest.fn().mockResolvedValue(targetAudienceStats),
    };
    const { client, dataset } = makeBigQuery([], false);
    const factory = jest.fn().mockReturnValue(client);
    const service = new BigQueryAnalyticsExportService(
      stats as unknown as StatsService,
      makeConfig(enabledConfig) as never,
      factory,
      makeCustomGroupRepository() as never,
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
    expect(createOptions.schema.map(field => field.name)).not.toContain('interactions');
    expect(createOptions.schema).toContainEqual({ name: 'target_audience', type: 'STRING', mode: 'NULLABLE' });
    expect(stats.getMessageStatsForRange).toHaveBeenCalledWith(
      new Date('2026-09-16T00:00:00.000Z'),
      new Date('2026-09-23T00:00:00.000Z'),
    );
    const mergeCall = client.query.mock.calls.find(call => String(call[0].query).includes('MERGE'));
    expect(mergeCall).toBeDefined();
    const rows = mergeCall?.[0].params?.rows;
    expect(rows).toHaveLength(2);
    expect(rows?.[0]).toEqual(
      expect.objectContaining({
        export_id: 'openwa-7d-20260923T000000Z',
        target_audience: 'Overall',
        window_days: 7,
        sent: 12,
        received: 7,
        active_groups: 1,
        delivered_recipients: 30,
        read_recipients: 21,
      }),
    );
    expect(rows?.[1]).toEqual(
      expect.objectContaining({
        target_audience: 'Teachers',
        sent: 8,
        received: 3,
        active_groups: 2,
      }),
    );
    expect(rows?.[1]?.export_id).toMatch(/^openwa-7d-20260923T000000Z-audience-[a-f0-9]{16}$/);
    expect(rows?.every(row => !Object.prototype.hasOwnProperty.call(row, 'interactions'))).toBe(true);
  });

  it('exports normal-login and API-session analytics as separate rows', async () => {
    const stats = {
      getMessageStatsForRange: jest.fn(
        (_start: Date, _end: Date, _groupIds: readonly string[] = [], sessionIds: readonly string[] = []) =>
          Promise.resolve(sessionIds.includes('api-1') ? apiAnalytics : analytics),
      ),
      getTargetAudienceStatsForRange: jest.fn().mockResolvedValue(targetAudienceStats),
    };
    const { client } = makeBigQuery([]);
    const service = new BigQueryAnalyticsExportService(
      stats as unknown as StatsService,
      makeConfig({
        ...enabledConfig,
        'stats.bigQueryExport.normalSessionIds': 'normal-1,normal-2',
        'stats.bigQueryExport.apiSessionIds': 'api-1',
      }) as never,
      jest.fn().mockReturnValue(client),
      makeCustomGroupRepository() as never,
    );

    await expect(service.exportDueWindow(new Date('2026-09-23T12:00:00.000Z'))).resolves.toBe('exported');

    expect(stats.getMessageStatsForRange).toHaveBeenCalledWith(
      new Date('2026-09-16T00:00:00.000Z'),
      new Date('2026-09-23T00:00:00.000Z'),
      [],
      ['normal-1', 'normal-2'],
    );
    expect(stats.getMessageStatsForRange).toHaveBeenCalledWith(
      new Date('2026-09-16T00:00:00.000Z'),
      new Date('2026-09-23T00:00:00.000Z'),
      [],
      ['api-1'],
    );
    const mergeCall = client.query.mock.calls.find(call => String(call[0].query).includes('MERGE'));
    const rows = mergeCall?.[0].params?.rows;
    expect(rows).toHaveLength(3);
    expect(rows?.[0]).toEqual(expect.objectContaining({ target_audience: 'Overall', sent: 12 }));
    expect(rows?.[1]).toEqual(
      expect.objectContaining({
        export_id: 'openwa-7d-20260923T000000Z-scope-api',
        target_audience: 'API',
        sent: 5,
        received: 2,
        active_groups: 1,
        delivered_recipients: 14,
        read_recipients: 9,
      }),
    );
    expect(rows?.[2]).toEqual(expect.objectContaining({ target_audience: 'Teachers', sent: 8 }));
  });

  it('excludes API-session saved audiences from the normal-login audience rows', async () => {
    const stats = {
      getMessageStatsForRange: jest.fn(
        (_start: Date, _end: Date, _groupIds: readonly string[] = [], sessionIds: readonly string[] = []) =>
          Promise.resolve(sessionIds.includes('api-1') ? apiAnalytics : analytics),
      ),
      getTargetAudienceStatsForRange: jest.fn().mockResolvedValue(targetAudienceStats),
    };
    const repository = {
      find: jest.fn().mockResolvedValue([
        { name: 'Teachers', sessionId: 'normal-1', groupIds: ['team@g.us'] },
        { name: 'API saved group', sessionId: 'api-1', groupIds: ['api-team@g.us'] },
      ]),
    };
    const { client } = makeBigQuery([]);
    const service = new BigQueryAnalyticsExportService(
      stats as unknown as StatsService,
      makeConfig({
        ...enabledConfig,
        'stats.bigQueryExport.normalSessionIds': 'normal-1',
        'stats.bigQueryExport.apiSessionIds': 'api-1',
      }) as never,
      jest.fn().mockReturnValue(client),
      repository as never,
    );

    await expect(service.exportDueWindow(new Date('2026-09-23T12:00:00.000Z'))).resolves.toBe('exported');

    expect(stats.getTargetAudienceStatsForRange).toHaveBeenCalledTimes(1);
    expect(stats.getTargetAudienceStatsForRange).toHaveBeenCalledWith(
      new Date('2026-09-16T00:00:00.000Z'),
      new Date('2026-09-23T00:00:00.000Z'),
      'normal-1',
      ['team@g.us'],
    );
    const mergeCall = client.query.mock.calls.find(call => String(call[0].query).includes('MERGE'));
    expect(mergeCall?.[0].params?.rows?.map(row => row.target_audience)).toEqual(['Overall', 'API', 'Teachers']);
  });

  it('does not export until 7 days after the latest BigQuery window', async () => {
    const stats = { getMessageStatsForRange: jest.fn() };
    const { client } = makeBigQuery([
      { export_id: 'openwa-15d-20260923T000000Z', window_end: { value: '2026-09-23T00:00:00.000Z' } },
    ]);
    const service = new BigQueryAnalyticsExportService(
      stats as unknown as StatsService,
      makeConfig(enabledConfig) as never,
      jest.fn().mockReturnValue(client),
      makeCustomGroupRepository() as never,
    );

    await expect(service.exportDueWindow(new Date('2026-09-23T12:00:00.000Z'))).resolves.toBe('already-exported');
    expect(stats.getMessageStatsForRange).not.toHaveBeenCalled();
  });

  it('adds target_audience to an existing destination table', async () => {
    const stats = { getMessageStatsForRange: jest.fn() };
    const { client, table } = makeBigQuery([
      { export_id: 'openwa-7d-20260923T000000Z', window_end: '2026-09-23T00:00:00.000Z' },
    ]);
    table.getMetadata.mockResolvedValueOnce([{ schema: { fields: [{ name: 'export_id', type: 'STRING' }] } }]);
    const service = new BigQueryAnalyticsExportService(
      stats as unknown as StatsService,
      makeConfig(enabledConfig) as never,
      jest.fn().mockReturnValue(client),
      makeCustomGroupRepository() as never,
    );

    await expect(service.exportDueWindow(new Date('2026-09-24T00:00:00.000Z'))).resolves.toBe('already-exported');
    expect(table.setMetadata).toHaveBeenCalledWith({
      schema: {
        fields: [
          { name: 'export_id', type: 'STRING' },
          { name: 'target_audience', type: 'STRING', mode: 'NULLABLE' },
        ],
      },
    });
  });

  it('removes the legacy interactions column from an existing destination table', async () => {
    const stats = { getMessageStatsForRange: jest.fn() };
    const { client, table } = makeBigQuery([
      { export_id: 'openwa-7d-20260923T000000Z', window_end: '2026-09-23T00:00:00.000Z' },
    ]);
    table.getMetadata.mockResolvedValueOnce([
      {
        schema: {
          fields: [
            { name: 'interactions', type: 'INTEGER' },
            { name: 'target_audience', type: 'STRING' },
          ],
        },
      },
    ]);
    const service = new BigQueryAnalyticsExportService(
      stats as unknown as StatsService,
      makeConfig(enabledConfig) as never,
      jest.fn().mockReturnValue(client),
      makeCustomGroupRepository() as never,
    );

    await expect(service.exportDueWindow(new Date('2026-09-24T00:00:00.000Z'))).resolves.toBe('already-exported');

    expect(
      client.query.mock.calls.some(([options]) =>
        options.query.includes('ALTER TABLE `openwa_analytics.message_analytics_7d` DROP COLUMN interactions'),
      ),
    ).toBe(true);
  });

  it('replaces the former JSON target_audience column with STRING', async () => {
    const stats = { getMessageStatsForRange: jest.fn() };
    const { client, table } = makeBigQuery([
      { export_id: 'openwa-7d-20260923T000000Z', window_end: '2026-09-23T00:00:00.000Z' },
    ]);
    table.getMetadata.mockResolvedValueOnce([{ schema: { fields: [{ name: 'target_audience', type: 'JSON' }] } }]);
    const service = new BigQueryAnalyticsExportService(
      stats as unknown as StatsService,
      makeConfig(enabledConfig) as never,
      jest.fn().mockReturnValue(client),
      makeCustomGroupRepository() as never,
    );

    await expect(service.exportDueWindow(new Date('2026-09-24T00:00:00.000Z'))).resolves.toBe('already-exported');
    expect(client.query.mock.calls.some(([options]) => options.query.includes('DROP COLUMN target_audience'))).toBe(
      true,
    );
  });

  it('labels historical rows without a target audience as Overall', async () => {
    const stats = { getMessageStatsForRange: jest.fn() };
    const { client } = makeBigQuery([
      { export_id: 'openwa-7d-20260923T000000Z', window_end: '2026-09-23T00:00:00.000Z' },
    ]);
    const service = new BigQueryAnalyticsExportService(
      stats as unknown as StatsService,
      makeConfig(enabledConfig) as never,
      jest.fn().mockReturnValue(client),
      makeCustomGroupRepository() as never,
    );

    await expect(service.exportDueWindow(new Date('2026-09-24T00:00:00.000Z'))).resolves.toBe('already-exported');

    expect(
      client.query.mock.calls.some(
        ([options]) =>
          options.query.includes('SET target_audience = @overall') && options.params?.overall === 'Overall',
      ),
    ).toBe(true);
  });

  it('continues with the next consecutive 7-day window when it is due, including after a legacy 15-day row', async () => {
    const stats = {
      getMessageStatsForRange: jest.fn().mockResolvedValue(analytics),
      getTargetAudienceStatsForRange: jest.fn().mockResolvedValue(targetAudienceStats),
    };
    const { client } = makeBigQuery([
      { export_id: 'openwa-15d-20260923T000000Z', window_end: '2026-09-23T00:00:00.000Z' },
    ]);
    const service = new BigQueryAnalyticsExportService(
      stats as unknown as StatsService,
      makeConfig(enabledConfig) as never,
      jest.fn().mockReturnValue(client),
      makeCustomGroupRepository() as never,
    );

    await expect(service.exportDueWindow(new Date('2026-09-30T12:00:00.000Z'))).resolves.toBe('exported');
    expect(stats.getMessageStatsForRange).toHaveBeenCalledWith(
      new Date('2026-09-23T00:00:00.000Z'),
      new Date('2026-09-30T00:00:00.000Z'),
    );
    const mergeCall = client.query.mock.calls.find(call => String(call[0].query).includes('MERGE'));
    expect(mergeCall?.[0].params?.rows?.[0]).toEqual(
      expect.objectContaining({ export_id: 'openwa-7d-20260930T000000Z', target_audience: 'Overall' }),
    );
  });

  it('does not publish an in-progress window from the explicit start boundary', async () => {
    const stats = {
      getMessageStatsForRange: jest.fn().mockResolvedValue(analytics),
      getTargetAudienceStatsForRange: jest.fn().mockResolvedValue(targetAudienceStats),
    };
    const { client } = makeBigQuery([]);
    const service = new BigQueryAnalyticsExportService(
      stats as unknown as StatsService,
      makeConfig({
        ...enabledConfig,
        'stats.bigQueryExport.startAt': '2026-09-28T00:00:00.000Z',
      }) as never,
      jest.fn().mockReturnValue(client),
      makeCustomGroupRepository() as never,
    );

    await expect(service.exportDueWindow(new Date('2026-10-01T00:00:00.000Z'))).resolves.toBe('already-exported');
    expect(stats.getMessageStatsForRange).not.toHaveBeenCalled();
    expect(client.query.mock.calls.filter(([options]) => options.query.includes('MERGE'))).toHaveLength(0);
  });

  it('exports the first complete window from the explicit start boundary when due', async () => {
    const stats = {
      getMessageStatsForRange: jest.fn().mockResolvedValue(analytics),
      getTargetAudienceStatsForRange: jest.fn().mockResolvedValue(targetAudienceStats),
    };
    const { client } = makeBigQuery([]);
    const service = new BigQueryAnalyticsExportService(
      stats as unknown as StatsService,
      makeConfig({
        ...enabledConfig,
        'stats.bigQueryExport.startAt': '2026-09-28T00:00:00.000Z',
      }) as never,
      jest.fn().mockReturnValue(client),
      makeCustomGroupRepository() as never,
    );

    await expect(service.exportDueWindow(new Date('2026-10-05T00:00:00.000Z'))).resolves.toBe('exported');
    expect(stats.getMessageStatsForRange).toHaveBeenCalledWith(
      new Date('2026-09-28T00:00:00.000Z'),
      new Date('2026-10-05T00:00:00.000Z'),
    );
    expect(client.query.mock.calls.filter(([options]) => options.query.includes('MERGE'))).toHaveLength(1);
  });

  it('starts after the latest completed configured window instead of refreshing it', async () => {
    const stats = {
      getMessageStatsForRange: jest.fn().mockResolvedValue(analytics),
      getTargetAudienceStatsForRange: jest.fn().mockResolvedValue(targetAudienceStats),
    };
    const { client } = makeBigQuery([
      {
        export_id: 'openwa-7d-20261005T000000Z',
        window_start: '2026-09-28T00:00:00.000Z',
        window_end: '2026-10-05T00:00:00.000Z',
      },
    ]);
    const service = new BigQueryAnalyticsExportService(
      stats as unknown as StatsService,
      makeConfig({
        ...enabledConfig,
        'stats.bigQueryExport.startAt': '2026-09-28T00:00:00.000Z',
      }) as never,
      jest.fn().mockReturnValue(client),
      makeCustomGroupRepository() as never,
    );

    await expect(service.exportDueWindow(new Date('2026-10-12T00:00:00.000Z'))).resolves.toBe('exported');
    expect(stats.getMessageStatsForRange).toHaveBeenCalledWith(
      new Date('2026-10-05T00:00:00.000Z'),
      new Date('2026-10-12T00:00:00.000Z'),
    );
    expect(stats.getMessageStatsForRange).not.toHaveBeenCalledWith(
      new Date('2026-09-28T00:00:00.000Z'),
      new Date('2026-10-05T00:00:00.000Z'),
    );
  });

  it('does not create a client or query analytics when the exporter is disabled', async () => {
    const stats = { getMessageStatsForRange: jest.fn() };
    const factory = jest.fn();
    const service = new BigQueryAnalyticsExportService(
      stats as unknown as StatsService,
      makeConfig({ 'stats.bigQueryExport.enabled': false }) as never,
      factory,
      makeCustomGroupRepository() as never,
    );

    await expect(service.exportDueWindow()).resolves.toBe('disabled');
    expect(factory).not.toHaveBeenCalled();
    expect(stats.getMessageStatsForRange).not.toHaveBeenCalled();
  });
});
