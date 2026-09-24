# BigQuery Analytics Export

OpenWA can export one analytics snapshot to BigQuery each UTC month. Each snapshot covers the exact
30-day half-open window ending at `00:00:00 UTC` on the first day of the month. For example, the
September 2026 export covers `2026-08-02T00:00:00Z` through, but not including,
`2026-09-01T00:00:00Z`.

The exporter is disabled by default. When enabled, it runs once at application startup and checks
hourly afterward. This makes an EC2 restart catch up a missed monthly run. A deterministic
`export_id` is checked before every insert, and the same value is also sent as BigQuery's `insertId`,
so retries do not intentionally create duplicate snapshots.

## Google Cloud setup

1. Enable the BigQuery API in the target Google Cloud project.
2. Create a service account for OpenWA.
3. Grant it permission to run BigQuery jobs and create/write the configured dataset and table. If
   the dataset and table are provisioned separately, grant only the corresponding read/write and
   job permissions.
4. Download the service-account JSON and copy it to the EC2 deployment host:

   ```bash
   mkdir -p ./data
   cp service-account.json ./data/bigquery-service-account.json
   chmod 600 ./data/bigquery-service-account.json
   ```

   The development compose file already bind-mounts `./data` at `/app/data`. For the production
   compose file, which uses a named data volume, create `docker-compose.override.yml` so only this
   credential is mounted from the host:

   ```yaml
   services:
     openwa-api:
       volumes:
         - ./data/bigquery-service-account.json:/run/secrets/openwa-bigquery.json:ro
   ```

   With that override, use
   `GOOGLE_APPLICATION_CREDENTIALS=/run/secrets/openwa-bigquery.json` below.

Google's client uses Application Default Credentials. Do not commit the JSON key to the repository.

## OpenWA configuration

Set these values in `.env`:

```dotenv
BIGQUERY_ANALYTICS_EXPORT_ENABLED=true
BIGQUERY_PROJECT_ID=my-google-cloud-project
BIGQUERY_DATASET_ID=openwa_analytics
BIGQUERY_TABLE_ID=monthly_message_analytics
BIGQUERY_LOCATION=australia-southeast1
GOOGLE_APPLICATION_CREDENTIALS=/run/secrets/openwa-bigquery.json
```

Then rebuild and restart the API container. On its first successful check, OpenWA creates the dataset
and a day-partitioned table when they do not already exist.

## Exported fields

Each monthly table row contains:

| Field                  | Meaning                                                               |
| ---------------------- | --------------------------------------------------------------------- |
| `export_id`            | Stable monthly id used for retry deduplication                        |
| `exported_at`          | Time OpenWA wrote the snapshot                                        |
| `window_start` / `end` | Exact UTC analytics window                                            |
| `window_days`          | Always `30`                                                           |
| `sent` / `received`    | Message totals                                                        |
| `interactions`         | Distinct session-and-chat conversations                               |
| `active_groups`        | Groups with activity in the window                                    |
| `delivered_recipients` | Sum of distinct delivered recipients per chat                         |
| `read_recipients`      | Sum of distinct readers per chat                                      |
| `reacted_messages`     | Outgoing messages with at least one active emoji reaction             |
| `emoji_reactions`      | Total active emoji reactions on outgoing messages                     |
| `analytics_json`       | Complete dashboard payload: time series, type/session/chat/group data |

The JSON payload can contain chat ids, phone-number JIDs, and group names. Apply the same access,
retention, and regional controls to the BigQuery dataset that you apply to the OpenWA message store.

## Verification

After restart, check the application logs for `Exported 30-day analytics window`, then run:

```sql
SELECT export_id, window_start, window_end, sent, received, read_recipients
FROM `my-google-cloud-project.openwa_analytics.monthly_message_analytics`
ORDER BY window_end DESC
LIMIT 12;
```

Authentication, permission, and transient BigQuery errors are logged and retried on the next hourly
check. Invalid OpenWA destination configuration fails during application startup.
