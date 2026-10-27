import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Cover the dashboard overview's all-history GROUP BY direction. On SQLite a messages row can hold
 * large inline media metadata, so a table scan blocks Node's synchronous better-sqlite3 connection
 * long enough for navigation/auth requests to time out. The narrow index makes that aggregate an
 * index-only scan.
 */
export class AddMessagesDirectionIndex1787000000000 implements MigrationInterface {
  name = 'AddMessagesDirectionIndex1787000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (queryRunner.dataSource.options.type === 'postgres') {
      await queryRunner.query('SET LOCAL statement_timeout = 0');
    }
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_messages_direction" ON "messages" ("direction")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_messages_direction"`);
  }
}
