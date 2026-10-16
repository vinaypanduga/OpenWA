# BigQuery Analytics Export

OpenWA exports one minimal set of aggregate analytics rows every 7 days. Each window contains one
`Overall` row plus one row for every saved target-audience name. By default, the first enabled run
exports the 7 completed UTC days ending at the current `00:00:00 UTC`. Set an explicit
start boundary when a new deployment must collect only future data. A window is published only
after all 7 days have elapsed. Later windows begin at the latest completed `window_end` already
present in BigQuery.

The exporter is disabled by default. When enabled, it runs once at application startup and checks
hourly afterward. This makes an EC2 restart catch up a missed interval. The latest BigQuery Overall row
preserves the schedule across restarts, while a deterministic `export_id` is also sent as BigQuery's
`insertId` so retries do not intentionally create duplicate snapshots. If the service was offline
for multiple intervals, it catches up one consecutive window per hourly check.

## Google Cloud setup

1. Enable the BigQuery API in the target Google Cloud project.
2. Create a dataset such as `openwa_analytics` in the required region. Creating it yourself is the
   recommended least-privilege option.
3. Create a service account for OpenWA. Grant **BigQuery Job User** on the project and **BigQuery
   Data Editor** on only the target dataset. If OpenWA must create the dataset too, it additionally
   needs a project-level role containing `bigquery.datasets.create`.
4. Download the service-account JSON and copy it into the persistent data volume of the running EC2
   container:

   ```bash
   docker cp service-account.json openwa-api:/app/data/bigquery-service-account.json
   docker exec -u root openwa-api chown openwa:openwa /app/data/bigquery-service-account.json
   docker exec -u root openwa-api chmod 600 /app/data/bigquery-service-account.json
   ```

   `/app/data` is the existing persistent Docker volume, so the key remains available when the API
   container is recreated. Keep the original host copy outside the repository and remove it after
   confirming the in-volume copy.

Google's client uses Application Default Credentials. Do not commit the JSON key to the repository.

## OpenWA configuration

Set these values in `.env`:

```dotenv
BIGQUERY_ANALYTICS_EXPORT_ENABLED=true
BIGQUERY_PROJECT_ID=my-google-cloud-project
BIGQUERY_DATASET_ID=openwa_analytics
BIGQUERY_TABLE_ID=message_analytics_7d
BIGQUERY_LOCATION=australia-southeast1
BIGQUERY_ANALYTICS_EXPORT_START_AT=2026-09-28T00:00:00.000Z
BIGQUERY_NORMAL_SESSION_IDS=normal-session-uuid
BIGQUERY_API_SESSION_IDS=api-session-uuid
GOOGLE_APPLICATION_CREDENTIALS=/app/data/bigquery-service-account.json
```

`BIGQUERY_ANALYTICS_EXPORT_START_AT` is optional. Use it only with an empty destination table. It
prevents historical backfill and establishes the first 7-day window. No partial row is written.
The exporter inserts the window only after its complete seven-day period has elapsed.

Set both session lists to separate dashboard activity from external API activity. `Overall` contains
only the sessions in `BIGQUERY_NORMAL_SESSION_IDS`, while `API` contains only the sessions in
`BIGQUERY_API_SESSION_IDS`. Multiple UUIDs are comma-separated. When these values are omitted, they
fall back to `DASHBOARD_PRIMARY_ALLOWED_SESSIONS` and `DASHBOARD_SECONDARY_ALLOWED_SESSIONS`.
The two lists must both be present and cannot overlap. API sessions produce only the `API` row;
they are excluded from `Overall` and saved-audience rows. `Overall` and saved audiences are emitted
once from the normal-login scope.

When upgrading from the former 15-day exporter, keep `BIGQUERY_TABLE_ID` pointed at the existing
table. Historical rows keep `window_days = 15`; the next row starts at the latest existing
`window_end`, covers seven days, and records `window_days = 7`. This preserves a continuous,
non-overlapping timeline without rewriting historical data. Use a new table name only when you
intentionally want separate history.

Then rebuild and restart the API container. On its first successful check, OpenWA creates the dataset
and a day-partitioned table when they do not already exist. Use a new table name when migrating from
the older monthly exporter because that table required an `analytics_json` column.

## Exported fields

Each 7-day table row contains:

| Field                  | Meaning                                                   |
| ---------------------- | --------------------------------------------------------- |
| `export_id`            | Stable 7-day window ID used for retry deduplication       |
| `exported_at`          | Time OpenWA wrote the snapshot                            |
| `window_start` / `end` | Exact half-open UTC analytics window                      |
| `window_days`          | Always `7`                                                |
| `sent` / `received`    | Message totals                                            |
| `active_groups`        | Groups with activity in the window                        |
| `delivered_recipients` | Sum of distinct delivered recipients per chat             |
| `read_recipients`      | Sum of distinct readers per chat                          |
| `reacted_messages`     | Outgoing messages with at least one active emoji reaction |
| `emoji_reactions`      | Total active emoji reactions on outgoing messages         |
| `target_audience`      | `Overall`, `API`, or the saved target-audience name       |

Every metric column belongs to the scope named in that row. For example, API analytics plus three
saved audiences produce five rows for a window:

| target_audience        | sent | received | active_groups | read_recipients |
| ---------------------- | ---: | -------: | ------------: | --------------: |
| Overall                | 1174 |      565 |           392 |            3015 |
| API                    |   84 |       17 |            14 |             128 |
| All gaziabad schools   | 1114 |      544 |           372 |            2903 |
| Karnataka group        |   60 |       21 |            20 |             112 |
| Another saved audience |    0 |        0 |             0 |               0 |

Each saved audience is evaluated against its owning WhatsApp session and saved group IDs. If the
same audience name exists in multiple sessions, its metrics are added into one name-wise object.
Audiences with no activity in the window are retained with zero values. Overlapping saved audiences
are intentionally independent, so one message can contribute to more than one audience row.

Existing tables are upgraded automatically. The former JSON `target_audience` column is replaced
with a nullable `STRING` column; its unwanted JSON values are discarded. Historical rows remain
`NULL` until re-exported. With split session lists configured, new completed windows contain one
`Overall` row, one `API` row, and one row per saved audience name. `Overall` and `API` are reserved
audience labels.

The export deliberately excludes phone numbers, chat IDs, WhatsApp group IDs/names, session
IDs/names, message bodies, time-series rows, and the former full `analytics_json` payload. Saved
target-audience names are the only names included.

## Verification

After restart, check the application logs for `Exported 7-day analytics window`, then run:

```sql
SELECT export_id, window_start, window_end, sent, received, read_recipients
FROM `my-google-cloud-project.openwa_analytics.message_analytics_7d`
ORDER BY window_end DESC
LIMIT 12;
```

To read the name-wise audience analytics:

```sql
SELECT
  export_id,
  target_audience,
  sent,
  received,
  active_groups,
  read_recipients
FROM `my-google-cloud-project.openwa_analytics.message_analytics_7d`
WHERE window_end = (
  SELECT MAX(window_end)
  FROM `my-google-cloud-project.openwa_analytics.message_analytics_7d`
)
ORDER BY target_audience;
```

Authentication, permission, and transient BigQuery errors are logged and retried on the next hourly
check. Invalid OpenWA destination configuration fails during application startup.
