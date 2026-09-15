import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Persists unique per-recipient delivery/read acknowledgements for outgoing messages. The arrays
 * make repeated engine events idempotent; the integer mirrors keep analytics portable because the
 * production databases use different JSON implementations.
 */
export class AddMessageRecipientReceipts1786800000000 implements MigrationInterface {
  name = 'AddMessageRecipientReceipts1786800000000';

  private async columnNames(queryRunner: QueryRunner): Promise<Set<string>> {
    if (queryRunner.connection.options.type === 'postgres') {
      const rows = (await queryRunner.query(
        `SELECT column_name FROM information_schema.columns
         WHERE table_schema = current_schema() AND table_name = 'messages'`,
      )) as Array<{ column_name: string }>;
      return new Set(rows.map(row => row.column_name));
    }
    const rows = (await queryRunner.query(`PRAGMA table_info("messages")`)) as Array<{ name: string }>;
    return new Set(rows.map(row => row.name));
  }

  public async up(queryRunner: QueryRunner): Promise<void> {
    const columns = await this.columnNames(queryRunner);
    if (!columns.has('deliveredTo')) {
      await queryRunner.query(`ALTER TABLE "messages" ADD COLUMN "deliveredTo" text NULL`);
    }
    if (!columns.has('readBy')) {
      await queryRunner.query(`ALTER TABLE "messages" ADD COLUMN "readBy" text NULL`);
    }
    if (!columns.has('deliveryCount')) {
      await queryRunner.query(`ALTER TABLE "messages" ADD COLUMN "deliveryCount" integer NOT NULL DEFAULT 0`);
    }
    if (!columns.has('readCount')) {
      await queryRunner.query(`ALTER TABLE "messages" ADD COLUMN "readCount" integer NOT NULL DEFAULT 0`);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const columns = await this.columnNames(queryRunner);
    if (columns.has('readCount')) await queryRunner.query(`ALTER TABLE "messages" DROP COLUMN "readCount"`);
    if (columns.has('deliveryCount')) {
      await queryRunner.query(`ALTER TABLE "messages" DROP COLUMN "deliveryCount"`);
    }
    if (columns.has('readBy')) await queryRunner.query(`ALTER TABLE "messages" DROP COLUMN "readBy"`);
    if (columns.has('deliveredTo')) await queryRunner.query(`ALTER TABLE "messages" DROP COLUMN "deliveredTo"`);
  }
}
