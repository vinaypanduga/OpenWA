import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BigQuery, Table } from '@google-cloud/bigquery';
import { MessageStats, StatsService } from './stats.service';

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
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
}

export interface MonthlyAnalyticsWindow {
  exportId: string;
  start: Date;
  end: Date;
}

export type BigQueryExportResult = 'disabled' | 'exported' | 'already-exported';

/** The completed rolling 30-day window ending at 00:00 UTC on the current month's first day. */
export function monthlyAnalyticsWindow(now: Date): MonthlyAnalyticsWindow {
  if (!Number.isFinite(now.getTime())) throw new RangeError('A valid date is required');
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const start = new Date(end.getTime() - THIRTY_DAYS_MS);
  const compactBoundary = end.toISOString().replace(/[-:]/g, '').replace('.000', '');
  return { exportId: `openwa-30d-${compactBoundary}`, start, end };
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
  { name: 'analytics_json', type: 'STRING', mode: 'REQUIRED' },
];

/**
 * Exports one dashboard-compatible snapshot per UTC month. The first tick runs at boot, so an EC2
 * restart catches up a missed boundary; subsequent hourly ticks make a failed export self-healing.
 * BigQuery's export_id lookup plus insertId make those retries idempotent.
 */
@Injectable()
export class BigQueryAnalyticsExportService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BigQueryAnalyticsExportService.name);
  private timer?: NodeJS.Timeout;
  private running = false;
  private lastCompletedExportId?: string;

  constructor(
    private readonly statsService: StatsService,
    private readonly configService: ConfigService,
    @Inject(BIGQUERY_CLIENT_FACTORY) private readonly createClient: BigQueryClientFactory,
  ) {}

  onModuleInit(): void {
    const settings = this.settings();
    if (!settings.enabled) return;

    this.logger.log(
      `Monthly BigQuery analytics export enabled for ${settings.projectId}.${settings.datasetId}.${settings.tableId}`,
    );
    void this.runScheduledExport();
    this.timer = setInterval(() => void this.runScheduledExport(), EXPORT_CHECK_INTERVAL_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** Export (or confirm) the monthly snapshot that is due for `now`. Public for operational tests. */
  async exportDueWindow(now = new Date()): Promise<BigQueryExportResult> {
    const settings = this.settings();
    if (!settings.enabled) return 'disabled';

    const window = monthlyAnalyticsWindow(now);
    if (this.lastCompletedExportId === window.exportId) return 'already-exported';

    const client = this.createClient(settings.projectId);
    const table = await this.ensureDestination(client, settings);
    const [existing] = await client.query({
      query: `SELECT export_id FROM \`${settings.datasetId}.${settings.tableId}\` WHERE export_id = @exportId LIMIT 1`,
      params: { exportId: window.exportId },
      location: settings.location,
    });
    if (existing.length > 0) {
      this.lastCompletedExportId = window.exportId;
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
    this.lastCompletedExportId = window.exportId;
    this.logger.log(
      `Exported 30-day analytics window ${window.start.toISOString()} to ${window.end.toISOString()} (${window.exportId})`,
    );
    return 'exported';
  }

  private async runScheduledExport(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.exportDueWindow();
    } catch (error) {
      const message = error instanceof Error ? error.stack || error.message : String(error);
      this.logger.error(`Monthly BigQuery analytics export failed; it will retry in one hour: ${message}`);
    } finally {
      this.running = false;
    }
  }

  private settings(): BigQueryExportSettings {
    const settings: BigQueryExportSettings = {
      enabled: this.configService.get<boolean>('stats.bigQueryExport.enabled', false),
      projectId: this.configService.get<string>('stats.bigQueryExport.projectId', ''),
      datasetId: this.configService.get<string>('stats.bigQueryExport.datasetId', 'openwa_analytics'),
      tableId: this.configService.get<string>('stats.bigQueryExport.tableId', 'monthly_message_analytics'),
      location: this.configService.get<string>('stats.bigQueryExport.location', 'US'),
    };
    if (!settings.enabled) return settings;
    if (!settings.projectId) throw new Error('BIGQUERY_PROJECT_ID is required when BigQuery export is enabled');
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
          description: 'Monthly snapshots of the preceding 30 days of OpenWA message analytics',
          timePartitioning: { type: 'DAY', field: 'window_end' },
        });
        this.logger.log(`Created BigQuery table ${settings.datasetId}.${settings.tableId}`);
      } catch (error) {
        if ((error as { code?: number }).code !== 409) throw error;
      }
    }
    return table;
  }

  private toRow(window: MonthlyAnalyticsWindow, analytics: MessageStats, exportedAt: Date): Record<string, unknown> {
    return {
      export_id: window.exportId,
      exported_at: BigQuery.timestamp(exportedAt).value,
      window_start: BigQuery.timestamp(window.start).value,
      window_end: BigQuery.timestamp(window.end).value,
      window_days: 30,
      sent: analytics.summary.sent,
      received: analytics.summary.received,
      interactions: analytics.summary.interactions,
      active_groups: analytics.groupBreakdown.length,
      delivered_recipients: analytics.summary.deliveredRecipients,
      read_recipients: analytics.summary.readRecipients,
      reacted_messages: analytics.summary.reactedMessages,
      emoji_reactions: analytics.summary.emojiReactions,
      analytics_json: JSON.stringify(analytics),
    };
  }
}
