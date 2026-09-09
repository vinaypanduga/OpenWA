import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddHistoryRetentionIndexes1786700000000 implements MigrationInterface {
  async up(runner: QueryRunner): Promise<void> {
    await runner.query(
      'CREATE INDEX IF NOT EXISTS "IDX_batches_retention" ON "message_batches" ("status", "updated_at")',
    );
    await runner.query(
      'CREATE INDEX IF NOT EXISTS "IDX_schedules_retention" ON "scheduled_messages" ("status", "updatedAt")',
    );
    await runner.query(
      'CREATE INDEX IF NOT EXISTS "IDX_schedules_batch" ON "scheduled_messages" ("sessionId", "batchId", "status")',
    );
  }

  async down(runner: QueryRunner): Promise<void> {
    for (const name of ['IDX_batches_retention', 'IDX_schedules_retention', 'IDX_schedules_batch']) {
      await runner.query(`DROP INDEX IF EXISTS "${name}"`);
    }
  }
}
