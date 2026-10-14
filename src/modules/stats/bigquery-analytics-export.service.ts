import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BigQuery, Table } from '@google-cloud/bigquery';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { createHash } from 'node:crypto';
import { CustomGroup } from '../custom-group/entities/custom-group.entity';
import { MessageStats, StatsService, TargetAudienceAnalyticsSummary } from './stats.service';

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const EXPORT_CHECK_INTERVAL_MS = 60 * 60 * 1000;
const BIGQUERY_ID = /^[A-Za-z_][A-Za-z0-9_]{0,1023}$/;
const TARGET_AUDIENCE_FIELD = { name: 'target_audience', type: 'STRING', mode: 'NULLABLE' } as const;
const OVERALL_TARGET_AUDIENCE = 'Overall';

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

/** The latest completed rolling 7-day window, ending at the current UTC midnight. */
export function sevenDayAnalyticsWindow(now: Date): AnalyticsExportWindow {
  if (!Number.isFinite(now.getTime())) throw new RangeError('A valid date is required');
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  return sevenDayWindowEndingAt(end);
}

function sevenDayWindowEndingAt(end: Date): AnalyticsExportWindow {
  const start = new Date(end.getTime() - SEVEN_DAYS_MS);
  const compactBoundary = end.toISOString().replace(/[-:]/g, '').replace('.000', '');
  return { exportId: `openwa-7d-${compactBoundary}`, start, end };
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
  TARGET_AUDIENCE_FIELD,
];

export interface TargetAudienceAnalytics extends TargetAudienceAnalyticsSummary {
  name: string;
}

/**
 * Exports one aggregate-only snapshot every 7 days. The first tick runs at boot and exports the
 * preceding 7 completed UTC days unless an explicit start boundary is configured. Later windows
 * continue from the latest BigQuery window_end, so restarts do not reset the cadence. The
 * deterministic export_id and insertId make retries idempotent without exporting chat IDs, phone
 * numbers, WhatsApp group names/IDs, message bodies, or the former full analytics JSON. The
 * target_audience column identifies either the Overall row or one saved audience name.
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
    @InjectRepository(CustomGroup, 'data') private readonly customGroupRepository: Repository<CustomGroup>,
  ) {}

  onModuleInit(): void {
    const settings = this.settings();
    if (!settings.enabled) return;

    this.logger.log(
      `7-day BigQuery analytics export enabled for ${settings.projectId}.${settings.datasetId}.${settings.tableId}`,
    );
    void this.runScheduledExport();
    this.timer = setInterval(() => void this.runScheduledExport(), EXPORT_CHECK_INTERVAL_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** Export the next 7-day snapshot when due. Public for operational tests. */
  async exportDueWindow(now = new Date()): Promise<BigQueryExportResult> {
    const settings = this.settings();
    if (!settings.enabled) return 'disabled';
    if (!Number.isFinite(now.getTime())) throw new RangeError('A valid date is required');
    if (!settings.startAt && this.nextExportDueAt !== undefined && now.getTime() < this.nextExportDueAt) {
      return 'already-exported';
    }

    const client = this.createClient(settings.projectId);
    await this.ensureDestination(client, settings);
    if (settings.startAt) return this.publishConfiguredWindow(client, settings, now);

    const [existing] = await client.query({
      query: `SELECT export_id, window_start, window_end FROM \`${settings.datasetId}.${settings.tableId}\` WHERE target_audience = @overall OR target_audience IS NULL ORDER BY window_end DESC LIMIT 1`,
      params: { overall: OVERALL_TARGET_AUDIENCE },
      location: settings.location,
    });

    let window: AnalyticsExportWindow;
    if (existing.length > 0) {
      const latestEnd = this.readWindowEnd(existing[0]);
      const nextEnd = new Date(latestEnd.getTime() + SEVEN_DAYS_MS);
      this.nextExportDueAt = nextEnd.getTime();
      if (now.getTime() < nextEnd.getTime()) return 'already-exported';
      window = sevenDayWindowEndingAt(nextEnd);
    } else window = sevenDayAnalyticsWindow(now);

    if (window.end.getTime() > now.getTime()) {
      return 'already-exported';
    }

    const [analytics, targetAudience] = await Promise.all([
      this.statsService.getMessageStatsForRange(window.start, window.end),
      this.getTargetAudienceAnalytics(window.start, window.end),
    ]);
    await this.upsertWindow(client, settings, window, analytics, targetAudience, now);
    this.nextExportDueAt = window.end.getTime() + SEVEN_DAYS_MS;
    this.logger.log(
      `Exported 7-day analytics window ${window.start.toISOString()} to ${window.end.toISOString()} (${window.exportId})`,
    );
    return 'exported';
  }

  /**
   * An explicit start boundary represents an operator asking to collect from that point forward.
   * Publish the open window immediately, refresh its rows hourly, and finalize elapsed windows
   * before moving to the next one. Each refresh replaces that window's Overall and saved-audience
   * rows, so renamed or deleted audiences do not leave stale rows behind.
   */
  private async publishConfiguredWindow(
    client: BigQuery,
    settings: BigQueryExportSettings & { startAt?: Date },
    now: Date,
  ): Promise<BigQueryExportResult> {
    const startAt = settings.startAt;
    if (!startAt || now.getTime() < startAt.getTime()) return 'already-exported';

    const [existing] = await client.query({
      query: `SELECT export_id, window_start, window_end FROM \`${settings.datasetId}.${settings.tableId}\` WHERE target_audience = @overall OR target_audience IS NULL ORDER BY window_end DESC LIMIT 1`,
      params: { overall: OVERALL_TARGET_AUDIENCE },
      location: settings.location,
    });

    let window =
      existing.length > 0
        ? sevenDayWindowEndingAt(this.readTimestamp(existing[0], 'window_end'))
        : sevenDayWindowEndingAt(new Date(startAt.getTime() + SEVEN_DAYS_MS));
    let published = false;

    while (now.getTime() >= window.end.getTime()) {
      const [analytics, targetAudience] = await Promise.all([
        this.statsService.getMessageStatsForRange(window.start, window.end),
        this.getTargetAudienceAnalytics(window.start, window.end),
      ]);
      await this.upsertWindow(client, settings, window, analytics, targetAudience, now);
      this.logger.log(
        `Finalized 7-day analytics window ${window.start.toISOString()} to ${window.end.toISOString()} (${window.exportId})`,
      );
      published = true;
      window = sevenDayWindowEndingAt(new Date(window.end.getTime() + SEVEN_DAYS_MS));
    }

    if (now.getTime() > window.start.getTime()) {
      const [analytics, targetAudience] = await Promise.all([
        this.statsService.getMessageStatsForRange(window.start, now),
        this.getTargetAudienceAnalytics(window.start, now),
      ]);
      await this.upsertWindow(client, settings, window, analytics, targetAudience, now);
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
      this.logger.error(`7-day BigQuery analytics export failed; it will retry in one hour: ${message}`);
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
      // Keep the legacy default table name so upgrades do not silently split their history across
      // two tables. New installations should explicitly configure a descriptive 7-day table name.
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
          description: 'Minimal aggregate snapshots of consecutive 7-day OpenWA analytics windows',
          timePartitioning: { type: 'DAY', field: 'window_end' },
        });
        this.logger.log(`Created BigQuery table ${settings.datasetId}.${settings.tableId}`);
      } catch (error) {
        if ((error as { code?: number }).code !== 409) throw error;
      }
    } else {
      const metadataResponse = (await table.getMetadata()) as unknown;
      const metadata =
        Array.isArray(metadataResponse) && typeof metadataResponse[0] === 'object' && metadataResponse[0] !== null
          ? (metadataResponse[0] as { schema?: { fields?: Array<Record<string, unknown>> } })
          : {};
      const fields = metadata.schema?.fields ?? [];
      const targetAudienceField = fields.find(field => field.name === TARGET_AUDIENCE_FIELD.name);
      if (!targetAudienceField) {
        await table.setMetadata({ schema: { fields: [...fields, TARGET_AUDIENCE_FIELD] } });
        this.logger.log(`Added target_audience column to ${settings.datasetId}.${settings.tableId}`);
      } else if (String(targetAudienceField.type).toUpperCase() !== TARGET_AUDIENCE_FIELD.type) {
        await client.query({
          query: `
            ALTER TABLE \`${settings.datasetId}.${settings.tableId}\` DROP COLUMN target_audience;
            ALTER TABLE \`${settings.datasetId}.${settings.tableId}\` ADD COLUMN target_audience STRING`,
          location: settings.location,
        });
        this.logger.log(`Changed target_audience column to STRING in ${settings.datasetId}.${settings.tableId}`);
      }

      // Rows exported before target-audience analytics existed have no label. They represent the
      // aggregate snapshot, so keep the column consistent by identifying them as Overall.
      await client.query({
        query: `UPDATE \`${settings.datasetId}.${settings.tableId}\` SET target_audience = @overall WHERE target_audience IS NULL OR TRIM(target_audience) = ''`,
        params: { overall: OVERALL_TARGET_AUDIENCE },
        location: settings.location,
      });
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

  private async upsertWindow(
    client: BigQuery,
    settings: BigQueryExportSettings,
    window: AnalyticsExportWindow,
    analytics: MessageStats,
    targetAudience: TargetAudienceAnalytics[],
    exportedAt: Date,
  ): Promise<void> {
    const rows = this.toRows(window, analytics, targetAudience, exportedAt);
    await client.query({
      query: `
        MERGE \`${settings.datasetId}.${settings.tableId}\` AS target
        USING UNNEST(@rows) AS source
        ON target.export_id = source.export_id
        WHEN MATCHED THEN UPDATE SET
          exported_at = TIMESTAMP(source.exported_at),
          window_start = TIMESTAMP(source.window_start),
          window_end = TIMESTAMP(source.window_end),
          window_days = source.window_days,
          sent = source.sent,
          received = source.received,
          interactions = source.interactions,
          active_groups = source.active_groups,
          delivered_recipients = source.delivered_recipients,
          read_recipients = source.read_recipients,
          reacted_messages = source.reacted_messages,
          emoji_reactions = source.emoji_reactions,
          target_audience = source.target_audience
        WHEN NOT MATCHED THEN INSERT (
          export_id, exported_at, window_start, window_end, window_days, sent, received,
          interactions, active_groups, delivered_recipients, read_recipients, reacted_messages,
          emoji_reactions, target_audience
        ) VALUES (
          source.export_id, TIMESTAMP(source.exported_at), TIMESTAMP(source.window_start), TIMESTAMP(source.window_end),
          source.window_days, source.sent, source.received, source.interactions, source.active_groups,
          source.delivered_recipients, source.read_recipients, source.reacted_messages,
          source.emoji_reactions, source.target_audience
        )
        WHEN NOT MATCHED BY SOURCE
          AND target.window_start = TIMESTAMP(@window_start)
          AND target.window_end = TIMESTAMP(@window_end)
        THEN DELETE`,
      params: {
        rows,
        window_start: BigQuery.timestamp(window.start).value,
        window_end: BigQuery.timestamp(window.end).value,
      },
      location: settings.location,
    });
  }

  private async getTargetAudienceAnalytics(start: Date, end: Date): Promise<TargetAudienceAnalytics[]> {
    const savedAudiences = await this.customGroupRepository.find({ order: { name: 'ASC' } });
    const analytics = await Promise.all(
      savedAudiences.map(async audience => ({
        name: audience.name,
        ...(await this.statsService.getTargetAudienceStatsForRange(start, end, audience.sessionId, audience.groupIds)),
      })),
    );

    const byName = new Map<string, TargetAudienceAnalytics>();
    for (const audience of analytics) {
      const existing = byName.get(audience.name);
      if (!existing) {
        byName.set(audience.name, { ...audience });
        continue;
      }
      existing.sent += audience.sent;
      existing.received += audience.received;
      existing.interactions += audience.interactions;
      existing.activeGroups += audience.activeGroups;
      existing.deliveredRecipients += audience.deliveredRecipients;
      existing.readRecipients += audience.readRecipients;
      existing.reactedMessages += audience.reactedMessages;
      existing.emojiReactions += audience.emojiReactions;
    }
    return [...byName.values()].sort((left, right) => left.name.localeCompare(right.name));
  }

  private toRows(
    window: AnalyticsExportWindow,
    analytics: MessageStats,
    targetAudience: TargetAudienceAnalytics[],
    exportedAt: Date,
  ): Array<Record<string, unknown>> {
    const base = {
      exported_at: BigQuery.timestamp(exportedAt).value,
      window_start: BigQuery.timestamp(window.start).value,
      window_end: BigQuery.timestamp(window.end).value,
      window_days: 7,
    };
    const rows: Array<Record<string, unknown>> = [
      {
        ...base,
        export_id: window.exportId,
        target_audience: OVERALL_TARGET_AUDIENCE,
        sent: analytics.summary.sent,
        received: analytics.summary.received,
        interactions: analytics.summary.interactions,
        active_groups: analytics.groupBreakdown.length,
        delivered_recipients: analytics.summary.deliveredRecipients,
        read_recipients: analytics.summary.readRecipients,
        reacted_messages: analytics.summary.reactedMessages,
        emoji_reactions: analytics.summary.emojiReactions,
      },
    ];
    for (const audience of targetAudience) {
      const audienceKey = createHash('sha256').update(audience.name).digest('hex').slice(0, 16);
      rows.push({
        ...base,
        export_id: `${window.exportId}-audience-${audienceKey}`,
        target_audience: audience.name,
        sent: audience.sent,
        received: audience.received,
        interactions: audience.interactions,
        active_groups: audience.activeGroups,
        delivered_recipients: audience.deliveredRecipients,
        read_recipients: audience.readRecipients,
        reacted_messages: audience.reactedMessages,
        emoji_reactions: audience.emojiReactions,
      });
    }
    return rows;
  }
}
