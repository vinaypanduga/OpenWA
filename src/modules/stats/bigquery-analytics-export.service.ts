import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BigQuery, Table } from '@google-cloud/bigquery';
import { MessageStats, StatsService } from './stats.service';

const FIFTEEN_DAYS_MS = 15 * 24 * 60 * 60 * 1000;
const EXPORT_CHECK_INTERVAL_MS = 60 * 60 * 1000;
const BIGQUERY_ID = /^[A-Za-z_][A-Za-z0-9_]{0,1023}$/;

export const BIGQUERY_CLIENT_FACTORY = Symbol('BIGQUERY_CLIENT_FACTORY');
export type BigQueryClientFactory = (projectId: string) => BigQuery;

interface BigQueryExportSettings {
  enabled: boolean;
  projectId: string;
  datasetId: string;
  tableId: string;
  location: string;
  startAt?: Date;
}

export interface AnalyticsExportWindow {
  exportId: string;
  start: Date;
  end: Date;
}

export type BigQueryExportResult = 'disabled' | 'exported' | 'already-exported';

/** The latest completed rolling 15-day window, ending at the current UTC midnight. */
export function fifteenDayAnalyticsWindow(now: Date): AnalyticsExportWindow {
  if (!Number.isFinite(now.getTime())) throw new RangeError('A valid date is required');
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  return fifteenDayWindowEndingAt(end);
}

function fifteenDayWindowEndingAt(end: Date): AnalyticsExportWindow {
  const start = new Date(end.getTime() - FIFTEEN_DAYS_MS);
  const compactBoundary = end.toISOString().replace(/[-:]/g, '').replace('.000', '');
  return { exportId: `openwa-15d-${compactBoundary}`, start, end };
}

const ANALYTICS_SCHEMA = [
  { name: 'export_id', type: 'STRING', mode: 'REQUIRED' },
  { name: 'exported_at', type: 'TIMESTAMP', mode: 'REQUIRED' },
  { name: 'window_start', type: 'TIMESTAMP', mode: 'REQUIRED' },
  { name: 'window_end', type: 'TIMESTAMP', mode: 'REQUIRED' },
  { name: 'window_days', type: 'INTEGER', mode: 'REQUIRED' },
  { name: 'sent', type: 'INTEGER', mode: 'REQUIRED' },
  { name: 'received', type: 'INTEGER', mode: 'REQUIRED' },
  { name: 'interactions', type: 'INTEGER', mode: 'REQUIRED' },
  { name: 'active_groups', type: 'INTEGER', mode: 'REQUIRED' },
  { name: 'delivered_recipients', type: 'INTEGER', mode: 'REQUIRED' },
  { name: 'read_recipients', type: 'INTEGER', mode: 'REQUIRED' },
  { name: 'reacted_messages', type: 'INTEGER', mode: 'REQUIRED' },
  { name: 'emoji_reactions', type: 'INTEGER', mode: 'REQUIRED' },
];

/**
 * Exports one aggregate-only snapshot every 15 days. The first tick runs at boot and exports the
 * preceding 15 completed UTC days unless an explicit start boundary is configured. Later windows
 * continue from the latest BigQuery window_end, so restarts do not reset the cadence. The
 * deterministic export_id and insertId make retries idempotent without exporting chat IDs, phone
 * numbers, group names, message bodies, or full JSON.
 */
@Injectable()
export class BigQueryAnalyticsExportService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BigQueryAnalyticsExportService.name);
  private timer?: NodeJS.Timeout;
  private running = false;
  private nextExportDueAt?: number;

  constructor(
    private readonly statsService: StatsService,
    private readonly configService: ConfigService,
    @Inject(BIGQUERY_CLIENT_FACTORY) private readonly createClient: BigQueryClientFactory,
  ) {}

  onModuleInit(): void {
    const settings = this.settings();
    if (!settings.enabled) return;

    this.logger.log(
      `15-day BigQuery analytics export enabled for ${settings.projectId}.${settings.datasetId}.${settings.tableId}`,
    );
    void this.runScheduledExport();
    this.timer = setInterval(() => void this.runScheduledExport(), EXPORT_CHECK_INTERVAL_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** Export the next 15-day snapshot when due. Public for operational tests. */
  async exportDueWindow(now = new Date()): Promise<BigQueryExportResult> {
    const settings = this.settings();
    if (!settings.enabled) return 'disabled';
    if (!Number.isFinite(now.getTime())) throw new RangeError('A valid date is required');
    if (!settings.startAt && this.nextExportDueAt !== undefined && now.getTime() < this.nextExportDueAt) {
      return 'already-exported';
    }

    const client = this.createClient(settings.projectId);
    const table = await this.ensureDestination(client, settings);
    if (settings.startAt) return this.publishConfiguredWindow(client, settings, now);

    const [existing] = await client.query({
      query: `SELECT export_id, window_start, window_end FROM \`${settings.datasetId}.${settings.tableId}\` ORDER BY window_end DESC LIMIT 1`,
      location: settings.location,
    });

    let window: AnalyticsExportWindow;
    if (existing.length > 0) {
      const latestEnd = this.readWindowEnd(existing[0]);
      const nextEnd = new Date(latestEnd.getTime() + FIFTEEN_DAYS_MS);
      this.nextExportDueAt = nextEnd.getTime();
      if (now.getTime() < nextEnd.getTime()) return 'already-exported';
      window = fifteenDayWindowEndingAt(nextEnd);
    } else window = fifteenDayAnalyticsWindow(now);

    if (window.end.getTime() > now.getTime()) {
      return 'already-exported';
    }

    const analytics = await this.statsService.getMessageStatsForRange(window.start, window.end);
    await table.insert(
      {
        insertId: window.exportId,
        json: this.toRow(window, analytics, now),
      },
      { raw: true },
    );
    this.nextExportDueAt = window.end.getTime() + FIFTEEN_DAYS_MS;
    this.logger.log(
      `Exported 15-day analytics window ${window.start.toISOString()} to ${window.end.toISOString()} (${window.exportId})`,
    );
    return 'exported';
  }

  /**
   * An explicit start boundary represents an operator asking to collect from that point forward.
   * Publish the open window immediately, refresh that same row hourly, and finalize elapsed windows
   * before moving to the next one. This keeps exactly one row per 15-day window while making the
   * current AWS-only analytics visible from day one.
   */
  private async publishConfiguredWindow(
    client: BigQuery,
    settings: BigQueryExportSettings & { startAt?: Date },
    now: Date,
  ): Promise<BigQueryExportResult> {
    const startAt = settings.startAt;
    if (!startAt || now.getTime() < startAt.getTime()) return 'already-exported';

    const [existing] = await client.query({
      query: `SELECT export_id, window_start, window_end FROM \`${settings.datasetId}.${settings.tableId}\` ORDER BY window_end DESC LIMIT 1`,
      location: settings.location,
    });

    let window =
      existing.length > 0
        ? fifteenDayWindowEndingAt(this.readTimestamp(existing[0], 'window_end'))
        : fifteenDayWindowEndingAt(new Date(startAt.getTime() + FIFTEEN_DAYS_MS));
    let published = false;

    while (now.getTime() >= window.end.getTime()) {
      const analytics = await this.statsService.getMessageStatsForRange(window.start, window.end);
      await this.upsertRow(client, settings, window, analytics, now);
      this.logger.log(
        `Finalized 15-day analytics window ${window.start.toISOString()} to ${window.end.toISOString()} (${window.exportId})`,
      );
      published = true;
      window = fifteenDayWindowEndingAt(new Date(window.end.getTime() + FIFTEEN_DAYS_MS));
    }

    if (now.getTime() > window.start.getTime()) {
      const analytics = await this.statsService.getMessageStatsForRange(window.start, now);
      await this.upsertRow(client, settings, window, analytics, now);
      this.logger.log(
        `Refreshed in-progress analytics window ${window.start.toISOString()} to ${window.end.toISOString()} (${window.exportId})`,
      );
      published = true;
    }

    return published ? 'exported' : 'already-exported';
  }

  private async runScheduledExport(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.exportDueWindow();
    } catch (error) {
      const message = error instanceof Error ? error.stack || error.message : String(error);
      this.logger.error(`15-day BigQuery analytics export failed; it will retry in one hour: ${message}`);
    } finally {
      this.running = false;
    }
  }

  private settings(): BigQueryExportSettings {
    const startAtRaw = this.configService.get<string>('stats.bigQueryExport.startAt', '').trim();
    const settings: BigQueryExportSettings = {
      enabled: this.configService.get<boolean>('stats.bigQueryExport.enabled', false),
      projectId: this.configService.get<string>('stats.bigQueryExport.projectId', ''),
      datasetId: this.configService.get<string>('stats.bigQueryExport.datasetId', 'openwa_analytics'),
      tableId: this.configService.get<string>('stats.bigQueryExport.tableId', 'message_analytics_15d'),
      location: this.configService.get<string>('stats.bigQueryExport.location', 'US'),
      startAt: startAtRaw ? new Date(startAtRaw) : undefined,
    };
    if (!settings.enabled) return settings;
    if (!settings.projectId) throw new Error('BIGQUERY_PROJECT_ID is required when BigQuery export is enabled');
    if (settings.startAt && !Number.isFinite(settings.startAt.getTime())) {
      throw new Error('BIGQUERY_ANALYTICS_EXPORT_START_AT must be a valid ISO-8601 timestamp');
    }
    for (const [key, value] of [
      ['BIGQUERY_DATASET_ID', settings.datasetId],
      ['BIGQUERY_TABLE_ID', settings.tableId],
    ]) {
      if (!BIGQUERY_ID.test(value)) throw new Error(`${key} must be a valid BigQuery identifier`);
    }
    return settings;
  }

  private async ensureDestination(client: BigQuery, settings: BigQueryExportSettings): Promise<Table> {
    const dataset = client.dataset(settings.datasetId, { location: settings.location });
    const [datasetExists] = await dataset.exists();
    if (!datasetExists) {
      try {
        await client.createDataset(settings.datasetId, {
          location: settings.location,
          description: 'OpenWA analytics exports',
        });
        this.logger.log(`Created BigQuery dataset ${settings.datasetId} in ${settings.location}`);
      } catch (error) {
        // Another OpenWA node can win the create race after our exists() check.
        if ((error as { code?: number }).code !== 409) throw error;
      }
    }

    const table = dataset.table(settings.tableId);
    const [tableExists] = await table.exists();
    if (!tableExists) {
      try {
        await dataset.createTable(settings.tableId, {
          schema: ANALYTICS_SCHEMA,
          description: 'Minimal aggregate snapshots of consecutive 15-day OpenWA analytics windows',
          timePartitioning: { type: 'DAY', field: 'window_end' },
        });
        this.logger.log(`Created BigQuery table ${settings.datasetId}.${settings.tableId}`);
      } catch (error) {
        if ((error as { code?: number }).code !== 409) throw error;
      }
    }
    return table;
  }

  private readTimestamp(row: unknown, field: 'window_start' | 'window_end'): Date {
    const raw = (row as Record<string, unknown> | undefined)?.[field];
    const value =
      raw instanceof Date
        ? raw
        : typeof raw === 'object' && raw !== null && 'value' in raw
          ? new Date(String(raw.value))
          : new Date(String(raw));
    if (!Number.isFinite(value.getTime())) throw new Error(`BigQuery returned an invalid ${field} value`);
    return value;
  }

  private readWindowEnd(row: unknown): Date {
    return this.readTimestamp(row, 'window_end');
  }

  private async upsertRow(
    client: BigQuery,
    settings: BigQueryExportSettings,
    window: AnalyticsExportWindow,
    analytics: MessageStats,
    exportedAt: Date,
  ): Promise<void> {
    const row = this.toRow(window, analytics, exportedAt);
    await client.query({
      query: `
        MERGE \`${settings.datasetId}.${settings.tableId}\` AS target
        USING (SELECT @export_id AS export_id) AS source
        ON target.export_id = source.export_id
        WHEN MATCHED THEN UPDATE SET
          exported_at = TIMESTAMP(@exported_at),
          window_start = TIMESTAMP(@window_start),
          window_end = TIMESTAMP(@window_end),
          window_days = @window_days,
          sent = @sent,
          received = @received,
          interactions = @interactions,
          active_groups = @active_groups,
          delivered_recipients = @delivered_recipients,
          read_recipients = @read_recipients,
          reacted_messages = @reacted_messages,
          emoji_reactions = @emoji_reactions
        WHEN NOT MATCHED THEN INSERT (
          export_id, exported_at, window_start, window_end, window_days, sent, received,
          interactions, active_groups, delivered_recipients, read_recipients, reacted_messages,
          emoji_reactions
        ) VALUES (
          @export_id, TIMESTAMP(@exported_at), TIMESTAMP(@window_start), TIMESTAMP(@window_end),
          @window_days, @sent, @received, @interactions, @active_groups, @delivered_recipients,
          @read_recipients, @reacted_messages, @emoji_reactions
        )`,
      params: row,
      location: settings.location,
    });
  }

  private toRow(window: AnalyticsExportWindow, analytics: MessageStats, exportedAt: Date): Record<string, unknown> {
    return {
      export_id: window.exportId,
      exported_at: BigQuery.timestamp(exportedAt).value,
      window_start: BigQuery.timestamp(window.start).value,
      window_end: BigQuery.timestamp(window.end).value,
      window_days: 15,
      sent: analytics.summary.sent,
      received: analytics.summary.received,
      interactions: analytics.summary.interactions,
      active_groups: analytics.groupBreakdown.length,
      delivered_recipients: analytics.summary.deliveredRecipients,
      read_recipients: analytics.summary.readRecipients,
      reacted_messages: analytics.summary.reactedMessages,
      emoji_reactions: analytics.summary.emojiReactions,
    };
  }
}
